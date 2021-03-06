(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.Tinode = f()}})(function(){var define,module,exports;return (function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
/**
 * @file Basic parser and formatter for very simple text markup. Mostly targeted at
 * mobile use cases similar to Telegram and WhatsApp.
 *
 * Supports:
 *   *abc* -> <b>abc</b>
 *   _abc_ -> <i>abc</i>
 *   ~abc~ -> <del>abc</del>
 *   `abc` -> <tt>abc</tt>
 *
 * Nested formatting is supported, e.g. *abc _def_* -> <b>abc <i>def</i></b>
 * URLs, @mentions, and #hashtags are extracted and converted into links.
 * JSON data representation is inspired by Draft.js raw formatting.
 *
 * @copyright 2015-2018 Tinode
 * @summary Javascript bindings for Tinode.
 * @license Apache 2.0
 * @version 0.15
 *
 * @example
 * Text:
 *     this is *bold*, `code` and _italic_, ~strike~
 *     combined *bold and _italic_*
 *     an url: https://www.example.com/abc#fragment and another _www.tinode.co_
 *     this is a @mention and a #hashtag in a string
 *     second #hashtag
 *
 *  Sample JSON representation of the text above:
 *  {
 *     "txt": "this is bold, code and italic, strike combined bold and italic an url: https://www.example.com/abc#fragment " +
 *             "and another www.tinode.co this is a @mention and a #hashtag in a string second #hashtag",
 *     "fmt": [
 *         { "at":8, "len":4,"tp":"ST" },{ "at":14, "len":4, "tp":"CO" },{ "at":23, "len":6, "tp":"EM"},
 *         { "at":31, "len":6, "tp":"DL" },{ "tp":"BR", "len":1, "at":37 },{ "at":56, "len":6, "tp":"EM" },
 *         { "at":47, "len":15, "tp":"ST" },{ "tp":"BR", "len":1, "at":62 },{ "at":120, "len":13, "tp":"EM" },
 *         { "at":71, "len":36, "key":0 },{ "at":120, "len":13, "key":1 },{ "tp":"BR", "len":1, "at":133 },
 *         { "at":144, "len":8, "key":2 },{ "at":159, "len":8, "key":3 },{ "tp":"BR", "len":1, "at":179 },
 *         { "at":187, "len":8, "key":3 },{ "tp":"BR", "len":1, "at":195 }
 *     ],
 *     "ent": [
 *         { "tp":"LN", "data":{ "url":"https://www.example.com/abc#fragment" } },
 *         { "tp":"LN", "data":{ "url":"http://www.tinode.co" } },
 *         { "tp":"MN", "data":{ "val":"mention" } },
 *         { "tp":"HT", "data":{ "val":"hashtag" } }
 *     ]
 *  }
 */

'use strict';

// Regular expressions for parsing inline formats. Javascript does not support lookbehind,
// so it's a bit messy.
const INLINE_STYLES = [
  // Strong = bold, *bold text*
  {name: "ST", start: /(?:^|\W)(\*)[^\s*]/, end: /[^\s*](\*)(?=$|\W)/},
  // Emphesized = italic, _italic text_
  {name: "EM", start: /(?:^|[\W_])(_)[^\s_]/, end: /[^\s_](_)(?=$|[\W_])/},
  // Deleted, ~strike this though~
  {name: "DL", start: /(?:^|\W)(~)[^\s~]/, end: /[^\s~](~)(?=$|\W)/},
  // Code block `this is monospace`
  {name: "CO", start: /(?:^|\W)(`)[^`]/, end: /[^`](`)(?=$|\W)/}
];

// RegExps for entity extraction (RF = reference)
const ENTITY_TYPES = [
  // URLs
  {name: "LN", dataName: "url",
    pack: function(val) {
      // Check if the protocol is specified, if not use http
      if (!/^[a-z]+:\/\//i.test(val)) {
        val = 'http://' + val;
      }
      return {url: val};
    },
    re: /(https?:\/\/)?(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{2,256}\.[a-z]{2,4}\b(?:[-a-zA-Z0-9@:%_\+.~#?&//=]*)/g},
  // Mentions @user (must be 2 or more characters)
  {name: "MN", dataName: "val",
    pack: function(val) { return {val: val.slice(1)}; },
    re: /\B@(\w\w+)/g},
  // Hashtags #hashtag, like metion 2 or more characters.
  {name: "HT", dataName: "val",
    pack: function(val) { return {val: val.slice(1)}; },
    re: /\B#(\w\w+)/g}
];

// HTML tag name suggestions
const HTML_TAGS = {
  ST: { name: 'b', isVoid: false },
  EM: { name: 'i', isVoid: false },
  DL: { name: 'del', isVoid: false },
  CO: { name: 'tt', isVoid: false },
  BR: { name: 'br', isVoid: true },
  LN: { name: 'a', isVoid: false },
  MN: { name: 'a', isVoid: false },
  HT: { name: 'a', isVoid: false },
  IM: { name: 'img', isVoid: true }
};

// Convert base64-encoded string into Blob.
function base64toObjectUrl(b64, contentType) {
  var bin;
  try {
    bin = atob(b64);
  } catch (err) {
    console.log("Drafty: failed to decode base64-encoded object", err.message);
    bin = atob("");
  }
  var length = bin.length;
  var buf = new ArrayBuffer(length);
  var arr = new Uint8Array(buf);
  for (var i = 0; i < length; i++) {
    arr[i] = bin.charCodeAt(i);
  }

  return URL.createObjectURL(new Blob([buf], {type: contentType}));
}

// Helpers for converting Drafty to HTML.
var DECORATORS = {
  ST: { open: function() { return '<b>'; }, close: function() { return '</b>'; }},
  EM: { open: function() { return '<i>'; }, close: function() { return '</i>'}},
  DL: { open: function() { return '<del>'; }, close: function() { return '</del>'}},
  CO: { open: function() { return '<tt>'; }, close: function() { return '</tt>'}},
  BR: { open: function() { return ''; }, close: function() { return '<br/>'}},
  LN: {
    open: function(data) { return '<a href="' + data.url + '">'; },
    close: function(data) { return '</a>'; },
    props: function(data) { return { href: data.url, target: "_blank" }; },
  },
  MN: {
    open: function(data) { return '<a href="#' + data.val + '">'; },
    close: function(data) { return '</a>'; },
    props: function(data) { return { name: data.val }; },
  },
  HT: {
    open: function(data) { return '<a href="#' + data.val + '">'; },
    close: function(data) { return '</a>'; },
    props: function(data) { return { name: data.val }; },
  },
  IM: {
    open: function(data) {
      // Don't use data.ref for preview: it's a security risk.
      var previewUrl = base64toObjectUrl(data.val, data.mime);
      var downloadUrl = data.ref ? data.ref : previewUrl;
      var res = (data.name ? '<a href="' + downloadUrl + '" download="' + data.name + '">' : '') +
        '<img src="' + previewUrl + '"' +
          (data.width ? ' width="' + data.width + '"' : '') +
          (data.height ? ' height="' + data.height + '"' : '') + ' border="0" />';
      console.log("open: " + res);
      return res;
    },
    close: function(data) {
      return (data.name ? '</a>' : '');
    },
    props: function(data) {
      var url = base64toObjectUrl(data.val, data.mime);
      return {
        src: url,
        title: data.name,
        'data-width': data.width,
        'data-height': data.height,
        'data-name': data.name,
        'data-size': (data.val.length * 0.75) | 0,
        'data-mime': data.mime
      };
    },
  }
};

/**
 * Th main object which performs all the formatting actions.
 * @class Drafty
 * @memberof Tinode
 * @constructor
 */
var Drafty = (function() {

  // Take a string and defined earlier style spans, re-compose them into a tree where each leaf is
  // a same-style (including unstyled) string. I.e. 'hello *bold _italic_* and ~more~ world' ->
  // ('hello ', (b: 'bold ', (i: 'italic')), ' and ', (s: 'more'), ' world');
  //
  // This is needed in order to clear markup, i.e. 'hello *world*' -> 'hello world' and convert
  // ranges from markup-ed offsets to plain text offsets.
  function chunkify(line, start, end, spans) {
    var chunks = [];

    if (spans.length == 0) {
      return [];
    }

    for (var i in spans) {
      // Get the next chunk from the queue
      var span = spans[i];

      // Grab the initial unstyled chunk
      if (span.start > start) {
        chunks.push({text: line.slice(start, span.start)});
      }

      // Grab the styled chunk. It may include subchunks.
      var chunk = {type: span.type};
      var chld = chunkify(line, span.start + 1, span.end - 1, span.children);
      if (chld.length > 0) {
        chunk.children = chld;
      } else {
        chunk.text = span.text;
      }
      chunks.push(chunk);
      start = span.end + 1; // '+1' is to skip the formatting character
    }

    // Grab the remaining unstyled chunk, after the last span
    if (start < end) {
      chunks.push({text: line.slice(start, end)});
    }

    return chunks;
  }

  // Same as chunkify but used for formatting.
  function forEach(line, start, end, spans, formatter, context) {
    // Add un-styled range before the styled span starts.
    // Process ranges calling formatter for each range.
    var result = [];
    for (var i = 0; i < spans.length; i++) {
      var span = spans[i];

      // Add un-styled range before the styled span starts.
      if (start < span.at) {
        result.push(formatter.call(context, null, undefined, line.slice(start, span.at)));
        start = span.at;
      }
      // Get all spans which are within current span.
      var subspans = [];
      for (var si = i + 1; si < spans.length && spans[si].at < span.at + span.len; si++) {
        subspans.push(spans[si]);
        i = si;
      }

      var tag = HTML_TAGS[span.tp] || {};
      result.push(formatter.call(context, span.tp, span.data,
        tag.isVoid ? null : forEach(line, start, span.at + span.len, subspans, formatter, context)));

      start = span.at + span.len;
    }

    // Add the last unformatted range.
    if (start < end) {
      result.push(formatter.call(context, null, undefined, line.slice(start, end)));
    }

    return result;
  }

  // Detect starts and ends of formatting spans. Unformatted spans are
  // ignored at this stage.
  function spannify(original, re_start, re_end, type) {
    var result = [];
    var index = 0;
    var line = original.slice(0); // make a copy;

    while (line.length > 0) {
      // match[0]; // match, like '*abc*'
      // match[1]; // match captured in parenthesis, like 'abc'
      // match['index']; // offset where the match started.

      // Find the opening token.
      var start = re_start.exec(line);
      if (start == null) {
        break;
      }

      // Because javascript RegExp does not support lookbehind, the actual offset may not point
      // at the markup character. Find it in the matched string.
      var start_offset = start['index'] + start[0].lastIndexOf(start[1]);
      // Clip the processed part of the string.
      line = line.slice(start_offset + 1);
      // start_offset is an offset within the clipped string. Convert to original index.
      start_offset += index;
      // Index now point to the beginning of 'line' within the 'original' string.
      index = start_offset + 1;

      // Find the matching closing token.
      var end = re_end ? re_end.exec(line) : null;
      if (end == null) {
        break;
      }
      var end_offset = end['index'] + end[0].indexOf(end[1]);
      // Clip the processed part of the string.
      line = line.slice(end_offset + 1);
      // Update offsets
      end_offset += index;
      // Index now point to the beginning of 'line' within the 'original' string.
      index = end_offset + 1;

      result.push({
        text: original.slice(start_offset+1, end_offset),
        children: [],
        start: start_offset,
        end: end_offset,
        type: type
      });
    }

    return result;
  }

  // Convert linear array or spans into a tree representation.
  // Keep standalone and nested spans, throw away partially overlapping spans.
  function toTree(spans) {
    if (spans.length == 0) {
      return [];
    }

    var tree = [spans[0]];
    var last = spans[0];
    for (var i = 1; i < spans.length; i++) {
      // Keep spans which start after the end of the previous span or those which
      // are complete within the previous span.

      if (spans[i].start > last.end) {
        // Span is completely outside of the previous span.
        tree.push(spans[i]);
        last = spans[i];
      } else if (spans[i].end < last.end) {
        // Span is fully inside of the previous span. Push to subnode.
        last.children.push(spans[i]);
      }
      // Span could partially overlap, ignoring it as invalid.
    }

    // Recursively rearrange the subnodes.
    for (var i in tree) {
      tree[i].children = toTree(tree[i].children);
    }

    return tree;
  }

  // Get a list of entities from a text.
  function extractEntities(line) {
    var match;
    var extracted = [];
    ENTITY_TYPES.map(function(entity) {
      while ((match = entity.re.exec(line)) !== null) {
        extracted.push({
          offset: match['index'],
          len: match[0].length,
          unique: match[0],
          data: entity.pack(match[0]),
          type: entity.name});
      }
    });

    if (extracted.length == 0) {
      return extracted;
    }

    // Remove entities detected inside other entities, like #hashtag in a URL.
    extracted.sort(function(a,b) {
      return a.offset - b.offset;
    });

    var idx = -1;
    extracted = extracted.filter(function(el) {
      var result = (el.offset > idx);
      idx = el.offset + el.len;
      return result;
    });

    return extracted;
  }

  // Convert the chunks into format suitable for serialization.
  function draftify(chunks, startAt) {
    var plain = "";
    var ranges = [];
    for (var i in chunks) {
      var chunk = chunks[i];
      if (!chunk.text) {
        var drafty = draftify(chunk.children, plain.length + startAt);
        chunk.text = drafty.txt;
        ranges = ranges.concat(drafty.fmt);
      }

      if (chunk.type) {
        ranges.push({at: plain.length + startAt, len: chunk.text.length, tp: chunk.type});
      }

      plain += chunk.text;
    }
    return {txt: plain, fmt: ranges};
  }

  // Splice two strings: insert second string into the first one at the given index
  function splice(src, at, insert) {
    return src.slice(0, at) + insert + src.slice(at);
  }

  return {

    /**
     * Parse plain text into structured representation.
     * @memberof Tinode.Drafty#
     * @static
     *
     * @param {String} content plain-text content to parse.
     * @return {Drafty} parsed object or null if the source is not plain text.
     */
    parse: function(content) {
      // Make sure we are parsing strings only.
      if (typeof content != "string") {
        return null;
      }

      // Split text into lines. It makes further processing easier.
      var lines = content.split(/\r?\n/);

      // Holds entities referenced from text
      var entityMap = [];
      var entityIndex = {};

      // Processing lines one by one, hold intermediate result in blx.
      var blx = [];
      lines.map(function(line) {
        var spans = [];
        var entities = [];

        // Find formatted spans in the string.
        // Try to match each style.
        INLINE_STYLES.map(function(style) {
          // Each style could be matched multiple times.
          spans = spans.concat(spannify(line, style.start, style.end, style.name));
        });

        var block;
        if (spans.length == 0) {
          block = {txt: line};
        } else {
          // Sort spans by style occurence early -> late
          spans.sort(function(a,b) {
            return a.start - b.start;
          });

          // Convert an array of possibly overlapping spans into a tree
          spans = toTree(spans);

          // Build a tree representation of the entire string, not
          // just the formatted parts.
          var chunks = chunkify(line, 0, line.length, spans);

          var drafty = draftify(chunks, 0);

          block = {txt: drafty.txt, fmt: drafty.fmt};
        }

        // Extract entities from the cleaned up string.
        entities = extractEntities(block.txt);
        if (entities.length > 0) {
          var ranges = [];
          for (var i in entities) {
            // {offset: match['index'], unique: match[0], len: match[0].length, data: ent.packer(), type: ent.name}
            var entity = entities[i];
            var index = entityIndex[entity.unique];
            if (!index) {
              index = entityMap.length;
              entityIndex[entity.unique] = index;
              entityMap.push({tp: entity.type, data: entity.data});
            }
            ranges.push({at: entity.offset, len: entity.len, key: index});
          }
          block.ent = ranges;
        }

        blx.push(block);
      });

      var result = {txt: ""};

      // Merge lines and save line breaks as BR inline formatting.
      if (blx.length > 0) {
        result.txt = blx[0].txt;
        result.fmt = (blx[0].fmt || []).concat(blx[0].ent || []);

        for (var i = 1; i<blx.length; i++) {
          var block = blx[i];
          var offset = result.txt.length + 1;

          result.fmt.push({tp: "BR", len: 1, at: offset - 1});

          result.txt += " " + block.txt;
          if (block.fmt) {
            result.fmt = result.fmt.concat(block.fmt.map(function(s) {
              s.at += offset; return s;
            }));
          }
          if (block.ent) {
            result.fmt = result.fmt.concat(block.ent.map(function(s) {
              s.at += offset; return s;
            }));
          }
        }

        if (result.fmt.length ==  0) {
          delete result.fmt;
        }

        if (entityMap.length > 0) {
          result.ent = entityMap;
        }
      }
      return result;
    },

    /**
     * Add inline image to Drafty content.
     * @memberof Tinode.Drafty#
     * @static
     *
     * @param {Drafty} content object to add image to.
     * @param {integer} at index where the object is inserted. The length of the image is always 1.
     * @param {string} mime mime-type of the image, e.g. "image/png"
     * @param {string} base64bits base64-encoded image content (or preview, if large image is attached)
     * @param {integer} width width of the image
     * @param {integer} height height of the image
     * @param {string} fname file name suggestion for downloading the image.
     * @param {integer} size size of the external file. Treat is as an untrusted hint.
     * @param {string} refurl reference to the content. Could be null or undefined.
     */
    insertImage: function(content, at, mime, base64bits, width, height, fname, size, refurl) {
      content = content || {txt: " "};
      content.ent = content.ent || [];
      content.fmt = content.fmt || [];

      content.fmt.push({
        at: at,
        len: 1,
        key: content.ent.length
      });
      content.ent.push({
        tp: "IM",
        data: {
          mime: mime,
          val: base64bits,
          width: width,
          height: height,
          name: fname,
          ref: refurl,
          size: size | 0
        }
      });

      return content;
    },

    /**
     * Add file to Drafty content. Either as a blob or as a reference.
     * @memberof Tinode.Drafty#
     * @static
     *
     * @param {Drafty} content object to attach file to.
     * @param {string} mime mime-type of the file, e.g. "image/png"
     * @param {string} base64bits base64-encoded file content
     * @param {string} fname file name suggestion for downloading.
     * @param {integer} size size of the external file. Treat is as an untrusted hint.
     * @param {string | Promise} refurl optional reference to the content.
     */
    attachFile: function(content, mime, base64bits, fname, size, refurl) {
      content = content || {txt: ""};
      content.ent = content.ent || [];
      content.fmt = content.fmt || [];

      content.fmt.push({
        at: -1,
        len: 0,
        key: content.ent.length
      });

      let ex = {
        tp: "EX",
        data: {
          mime: mime,
          val: base64bits,
          name: fname,
          ref: refurl,
          size: size | 0
        }
      }
      if (refurl instanceof Promise) {
        refurl.then(
          (url) => { ex.data.ref = url; },
          (err) => { /* catch error, otherwise it will appear in the console. */ }
        );
      }
      content.ent.push(ex);

      return content;
    },

    /**
     * Given the structured representation of rich text, convert it to HTML.
     * No attempt is made to strip pre-existing html markup.
     * This is potentially unsafe because `content.txt` may contain malicious
     * markup.
     * @memberof Tinode.Drafty#
     * @static
     *
     * @param {drafy} content - structured representation of rich text.
     *
     * @return HTML-representation of content.
     */
    UNSAFE_toHTML: function(content) {
      var {txt, fmt, ent} = content;

      var markup = [];
      if (fmt) {
        for (var i in fmt) {
          var range = fmt[i];
          var tp = range.tp, data;
          if (!tp) {
            var entity = ent[range.key];
            if (entity) {
              tp = entity.tp;
              data = entity.data;
            }
          }

          if (DECORATORS[tp]) {
            // Because we later sort in descending order, closing markup must come first.
            // Otherwise zero-length objects will not be represented correctly.
            markup.push({idx: range.at + range.len, what: DECORATORS[tp].close(data)});
            markup.push({idx: range.at, what: DECORATORS[tp].open(data)});
          }
        }
      }

      markup.sort(function(a, b) {
        return b.idx - a.idx; // in descending order
      });

      for (var i in markup) {
        if (markup[i].what) {
          txt = splice(txt, markup[i].idx, markup[i].what);
        }
      }

      return txt;
    },

    /**
     * Callback for applying custom formatting/transformation to a Drafty object.
     * Called once for each syle span.
     * @memberof Tinode.Drafty#
     * @static
     *
     * @callback Formatter
     * @param {string} style style code such as "ST" or "IM".
     * @param {Object} data entity's data
     * @param {Object} values possibly styled subspans contained in this style span.
     */

    /**
     * Transform Drafty using custom formatting.
     * @memberof Tinode.Drafty#
     * @static
     *
     * @param {Drafty} content - content to transform.
     * @param {Formatter} formatter - callback which transforms individual elements
     * @param {Object} context - context provided to formatter as 'this'.
     *
     * @return {Object} transformed object
     */
    format: function(content, formatter, context) {
      var {txt, fmt, ent} = content;

      txt = txt || "";

      if (!fmt) {
        return [txt];
      }

      var spans = [].concat(fmt);

      // Zero values may have been stripped. Restore them.
      spans.map(function(s) {
        s.at = s.at || 0;
        s.len = s.len || 0;
      });

      // Soft spans first by start index (asc) then by length (desc).
      spans.sort(function(a, b) {
        if (a.at - b.at == 0) {
          return b.len - a.len; // longer one comes first (<0)
        }
        return a.at - b.at;
      });

      // Denormalize entities into spans. Create a copy of the objects to leave
      // original Drafty object unchanged.
      spans = spans.map(function(s) {
        var data;
        var tp = s.tp;
        if (!tp) {
          s.key = s.key || 0;
          data = ent[s.key].data;
          tp = ent[s.key].tp;
        }
        return {tp: tp, data: data, at: s.at, len: s.len};
      });

      return forEach(txt, 0, txt.length, spans, formatter, context);
    },

    /**
     * Given structured representation of rich text, convert it to plain text.
     * @memberof Tinode.Drafty#
     * @static
     *
     * @param {Drafty} content - content to convert to plain text.
     */
    toPlainText: function(content) {
      return content.txt;
    },

    /**
     * Returns true if content has no markup and no entities.
     * @memberof Tinode.Drafty#
     * @static
     *
     * @param {Drafty} content - content to check for presence of markup.
     * @returns true is content is plain text, false otherwise.
     */
    isPlainText: function(content) {
      return !(content.fmt || content.ent);
    },

    /**
     * Check if the drafty content has attachments.
     * @memberof Tinode.Drafty#
     * @static
     *
     * @param {Drafty} content - content to check for attachments.
     * @returns true if there are attachments.
     */
    hasAttachments: function(content) {
      if (content.ent && content.ent.length > 0) {
        for (var i in content.ent) {
          if (content.ent[i].tp == "EX") {
            return true;
          }
        }
      }
      return false;
    },

    /**
     * Callback for applying custom formatting/transformation to a Drafty object.
     * Called once for each syle span.
     * @memberof Tinode.Drafty#
     * @static
     *
     * @callback AttachmentCallback
     * @param {Object} data attachment data
     * @param {number} index attachment's index in `content.ent`.
     */

    /**
     * Enumerate attachments.
     * @memberof Tinode.Drafty#
     * @static
     *
     * @param {Drafty} content - drafty object to process for attachments.
     * @param {AttachmentCallback} callback - callback to call for each attachment.
     * @param {Object} content - value of "this" for callback.
     */
    attachments: function(content, callback, context) {
      if (content.ent && content.ent.length > 0) {
        for (var i in content.ent) {
          if (content.ent[i].tp == "EX") {
            callback.call(context, content.ent[i].data, i);
          }
        }
      }
    },

    /**
     * Given the entity, get URL which can be used for downloading
     * entity data.
     * @memberof Tinode.Drafty#
     * @static
     *
     * @param {Object} entity.data to get the URl from.
     */
    getDownloadUrl: function(entData) {
      let url = null;
      if (entData.val) {
        url = base64toObjectUrl(entData.val, entData.mime);
      } else if (typeof entData.ref == 'string') {
        url = entData.ref;
      }
      return url;
    },

    /**
     * Check if the entity data is being uploaded to the server.
     * @memberof Tinode.Drafty#
     * @static
     *
     * @param {Object} entity.data to get the URl from.
     * @returns {boolean} true if upload is in progress, false otherwise.
     */
    isUploading: function(entData) {
      return entData.ref instanceof Promise;
    },

    /**
     * Given the entity, get URL which can be used for previewing
     * the entity.
     * @memberof Tinode.Drafty#
     * @static
     *
     * @param {Object} entity.data to get the URl from.
     *
     * @returns {string} url for previewing or null if no such url is available.
     */
    getPreviewUrl: function(entData) {
      return entData.val ? base64toObjectUrl(entData.val, entData.mime) : null;
    },

    /**
     * Get approximate size of the entity.
     * @memberof Tinode.Drafty#
     * @static
     *
     * @param {Object} entity.data to get the size for.
     */
    getEntitySize: function(entData) {
      // Either size hint or length of value. The value is base64 encoded,
      // the actual object size is smaller than the encoded length.
      return entData.size ? entData.size : entData.val ? (entData.val.length * 0.75) | 0 : 0;
    },

    /**
     * Get entity mime type.
     * @memberof Tinode.Drafty#
     * @static
     *
     * @param {Object} entity.data to get the type for.
     */
    getEntityMimeType: function(entData) {
      return entData.mime || "text/plain";
    },

    /**
     * Get HTML tag for a given two-letter style name
     * @memberof Tinode.Drafty#
     * @static
     *
     * @param {string} style - two-letter style, like ST or LN
     *
     * @returns {string} tag name
     */
    tagName: function(style) {
      return HTML_TAGS[style] ? HTML_TAGS[style].name : undefined;
    },

    /**
     * For a given data bundle generate an object with HTML attributes,
     * for instance, given {url: "http://www.example.com/"} return
     * {href: "http://www.example.com/"}
     * @memberof Tinode.Drafty#
     * @static
     *
     * @param {string} style - tw-letter style to generate attributes for.
     * @param {Object} data - data bundle to convert to attributes
     *
     * @returns {Object} object with HTML attributes.
     */
    attrValue: function(style, data) {
      if (data && DECORATORS[style]) {
        return DECORATORS[style].props(data);
      }

      return undefined;
    },

    /**
     * Drafty MIME type.
     * @memberof Tinode.Drafty#
     * @static
     *
     * @returns {string} HTTP Content-Type "text/x-drafty".
     */
    getContentType: function() {
      return "text/x-drafty";
    }
  };
});

module.exports = Drafty();

},{}],2:[function(require,module,exports){
/**
 * @file All the logic need to connect to Tinode chat server. Tinode is a single js
 * file with no dependencies. Just include <tt>tinode.js</tt> into your project.
 * It will add a singleton Tinode object to the top level object, usually <tt>window</tt>.
 * See <a href="https://github.com/tinode/example-react-js">https://github.com/tinode/example-react-js</a> for real-life usage.
 *
 * @copyright 2015-2018 Tinode
 * @summary Javascript bindings for Tinode.
 * @license Apache 2.0
 * @version 0.15
 *
 * @example
 * <head>
 * <script src=".../tinode.js"></script>
 * </head>
 *
 * <body>
 *  ...
 * <script>
 *  Tinode.enableLogging(true);
 *  // Add logic to handle disconnects.
 *  Tinode.onDisconnect = function() { ... };
 *  // Setup with the default transport, usually websocket.
 *  Tinode.setup(APP_NAME, HOST, API_KEY);
 *  // Connect to the server.
 *  Tinode.connect().then(function() {
 *    // Login.
 *    return Tinode.loginBasic(login, password);
 *  }).then(function(ctrl) {
 *    // Loggedin fine, attach callbacks, subscribe to 'me'.
 *    var me = Tinode.getMeTopic();
 *    me.onMetaDesc = function(meta) { ... };
 *    me.onData = function(invite) { ... };
 *    // Subscribe, fetch topic description, the list of contacts and messages (invites).
 *    me.subscribe({get: {desc: {}, sub: {}, data: {}}});
 *  }).catch(function(err) {
 *    // Login or subscription failed, do something.
 *    ...
 *  });
 *  ...
 * </script>
 * </body>
 */

'use strict';

var Drafty = require('./drafty.js');

// Global constants
const PROTOCOL_VERSION = "0";
const VERSION = "0.15";
const LIBRARY = "tinodejs/" + VERSION;

const TOPIC_NEW = "new";
const TOPIC_ME = "me";
const TOPIC_FND = "fnd";
const USER_NEW = "new";

// Unicode [del] symbol.
const DEL_CHAR = "\u2421";
// Starting value of a locally-generated seqId used for pending messages.
const LOCAL_SEQID = 0xFFFFFFF;

const MESSAGE_STATUS_NONE     = 0; // Status not assigned.
const MESSAGE_STATUS_QUEUED   = 1; // Local ID assigned, in progress to be sent.
const MESSAGE_STATUS_SENDING  = 2; // Transmission started.
const MESSAGE_STATUS_SENT     = 3; // Delivered to the server.
const MESSAGE_STATUS_RECEIVED = 4; // Received by the client.
const MESSAGE_STATUS_READ     = 5; // Read by the user.
const MESSAGE_STATUS_TO_ME    = 6; // Message from another user.
// Utility functions

// RFC3339 formater of Date
function rfc3339DateString(d) {
  if (!d || d.getTime() == 0) {
    return undefined;
  }

  function pad(val, sp) {
    sp = sp || 2;
    return '0'.repeat(sp - ('' + val).length) + val;
  }
  var millis = d.getUTCMilliseconds();
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) +
    'T' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) +
    (millis ? '.' + pad(millis, 3) : '') + 'Z';
}

// btoa replacement. Stock btoa fails on on non-Latin1 strings.
function b64EncodeUnicode(str) {
    // The encodeURIComponent percent-encodes UTF-8 string,
    // then the percent encoding is converted into raw bytes which
    // can be fed into btoa.
    return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g,
        function toSolidBytes(match, p1) {
            return String.fromCharCode('0x' + p1);
    }));
}

// Recursively merge src's own properties to dst.
// Ignore properties where ignore[property] is true.
// Array and Date objects are shallow-copied.
function mergeObj(dst, src, ignore) {
  // Handle the 3 simple types, and null or undefined
  if (src === null || src === undefined) {
    return dst;
  }

  if (typeof src !== "object") {
    return src ? src : dst;
  }

  // Handle Date
  if (src instanceof Date) {
    return src;
  }

  // Access mode
  if (src instanceof AccessMode) {
    return new AccessMode(src);
  }

  // Handle Array
  if (src instanceof Array) {
    return src.length > 0 ? src : dst;
  }

  if (!dst) {
    dst = src.constructor();
  }

  for (var prop in src) {
    if (src.hasOwnProperty(prop) &&
        (src[prop] || src[prop] === false) &&
        (!ignore || !ignore[prop]) &&
        (prop != '_generated')) {
      dst[prop] = mergeObj(dst[prop], src[prop]);
    }
  }
  return dst;
}

// Update object stored in a cache. Returns updated value.
function mergeToCache(cache, key, newval, ignore) {
  cache[key] = mergeObj(cache[key], newval, ignore);
  return cache[key];
}

// Basic cross-domain requester. Supports normal browsers and IE8+
function xdreq() {
  var xdreq = null;

  // Detect browser support for CORS
  if ('withCredentials' in new XMLHttpRequest()) {
    // Support for standard cross-domain requests
    xdreq = new XMLHttpRequest();
  } else if (typeof XDomainRequest !== "undefined") {
    // IE-specific "CORS" with XDR
    xdreq = new XDomainRequest();
  } else {
    // Browser without CORS support, don't know how to handle
    throw new Error("browser not supported");
  }

  return xdreq;
};

// JSON stringify helper - pre-processor for JSON.stringify
function jsonBuildHelper(key, val) {
  if (val instanceof Date) {
    // Convert javascript Date objects to rfc3339 strings
    val = rfc3339DateString(val);
  } else if (val === undefined || val === null || val === false ||
      (Array.isArray(val) && val.length == 0) ||
      ((typeof val === "object") && (Object.keys(val).length === 0))) {
      // strip out empty elements while serializing objects to JSON
    return undefined;
  }

  return val;
};

// Strips all values from an object of they evaluate to false or if their name starts with '_'.
function simplify(obj) {
	Object.keys(obj).forEach(function(key) {
    if (key[0] == "_") {
      // Strip fields like "obj._key".
      delete obj[key];
    } else if (!obj[key]) {
      // Strip fields which evaluate to false.
      delete obj[key];
    } else if (Array.isArray(obj[key]) && obj[key].length == 0) {
      // Strip empty arrays.
      delete obj[key];
    } else if (!obj[key]) {
      // Strip fields which evaluate to false.
      delete obj[key];
    } else if (typeof obj[key] == 'object' && !(obj[key] instanceof Date)) {
      simplify(obj[key]);
      // Strip empty objects.
      if (Object.getOwnPropertyNames(obj[key]).length == 0) {
      	delete obj[key];
      }
    }
  });
  return obj;
};

// Trim whitespace, strip empty and duplicate elements elements.
// If the result is an empty array, add a single element "\u2421" (Unicode Del character).
function normalizeArray(arr) {
  var out = [];
  if (Array.isArray(arr)) {
    // Trim, throw away very short and empty tags.
    for (var i =0, l=arr.length; i<l; i++) {
      var t = arr[i];
      if (t) {
        t = t.trim().toLowerCase();
        if (t.length > 1) {
          out.push(t);
        }
      }
    }
    out.sort().filter(function(item, pos, ary) {
      return !pos || item != ary[pos - 1];
    });
  }
  if (out.length == 0) {
    // Add single tag with a Unicode Del character, otherwise an ampty array
    // is ambiguos. The Del tag will be stripped by the server.
    out.push(DEL_CHAR);
  }
  return out;
}

// Attempt to convert date strings to objects.
function jsonParseHelper(key, val) {
  // Convert string timestamps with optional milliseconds to Date
  // 2015-09-02T01:45:43[.123]Z
  if (key === 'ts' && typeof val === 'string' &&
    val.length >= 20 && val.length <= 24) {
    var date = new Date(val);
    if (date) {
      return date;
    }
  } else if (key === 'acs' && typeof val === 'object') {
    return new AccessMode(val);
  }
  return val;
};

// Trims very long strings (encoded images) to make logged packets more readable.
function jsonLoggerHelper(key, val) {
  if (typeof val === 'string' && val.length > 128) {
    return "<" + val.length + ", bytes: " + val.substring(0, 12) + '...' + val.substring(val.length-12) + ">";
  }
  return jsonBuildHelper(key, val);
};

// Parse browser user agent to extract browser name and version.
function getBrowserInfo(ua) {

  // First test for WebKit based browser.
  ua = (ua||'').replace(' (KHTML, like Gecko)', '');
  var m = ua.match(/(AppleWebKit\/[.\d]+)/i);
  var result;
  if (m) {
    // List of common strings, from more useful to less useful.
    var priority = ['chrome', 'safari', 'mobile', 'version'];
    var tmp = ua.substr(m.index + m[0].length).split(" ");
    var tokens = [];
    // Split Name/0.0.0 into Name and version 0.0.0
    for (var i=0;i<tmp.length;i++) {
      var m2 = /([\w.]+)[\/]([\.\d]+)/.exec(tmp[i]);
      if (m2) {
        tokens.push([m2[1], m2[2], priority.findIndex(function(e) {
          return (e == m2[1].toLowerCase());
        })]);
      }
    }
    // Sort by priority: more interesting is earlier than less interesting.
    tokens.sort(function(a, b) {
      var diff = a[2] - b[2];
      return diff != 0 ? diff : b[0].length - a[0].length;
    });
    if (tokens.length > 0) {
      // Return the least common browser string and version.
      result = tokens[0][0] + "/" + tokens[0][1];
    } else {
      // Failed to ID the browser. Return the webkit version.
      result = m[1];
    }
  // Test for MSIE.
  } else if (/trident/i.test(ua)) {
    m = /(?:\brv[ :]+([.\d]+))|(?:\bMSIE ([.\d]+))/g.exec(ua);
    if (m) {
      result = "MSIE/" + (m[1] || m[2]);
    } else {
      result =  "MSIE/?";
    }
  // Test for Firefox.
  } else if (/firefox/i.test(ua)) {
    m = /Firefox\/([.\d]+)/g.exec(ua);
    if (m) {
      result = "Firefox/" + m[1];
    } else {
      result = "Firefox/?";
    }
  // Older Opera.
  } else if (/presto/i.test(ua)) {
    m = /Opera\/([.\d]+)/g.exec(ua);
    if (m) {
      result = "Opera/" + m[1];
    } else {
      result = "Opera/?";
    }
  } else {
    // Failed to parse anything meaningfull. Try the last resort.
    m = /([\w.]+)\/([.\d]+)/.exec(ua);
    if (m) {
      result = m[1] + "/" + m[2];
    } else {
      m = ua.split(" ");
      result = m[0];
    }
  }

  // Shorten the version to one dot 'a.bb.ccc.d -> a.bb' at most.
  m = result.split("/");
  if (m.length > 1) {
    var v = m[1].split(".");
    result = m[0] + "/" + v[0] + (v[1] ? "." + v[1] : '');
  }
  return result;
}

/**
 * In-memory sorted cache of objects.
 *
 * @class CBuffer
 * @memberof Tinode
 * @protected
 *
 * @param {function} compare custom comparator of objects. Returns -1 if a < b, 0 if a == b, 1 otherwise.
 */
var CBuffer = function(compare) {
  var buffer = [];

  compare = compare || function(a, b) {
    return a === b ? 0 : a < b ? -1 : 1;
  };

  function findNearest(elem, arr, exact) {
    var start = 0;
    var end = arr.length - 1;
    var pivot = 0;
    var diff = 0;
    var found = false;

    while (start <= end) {
      pivot = (start + end) / 2 | 0;
      diff = compare(arr[pivot], elem);
      if (diff < 0) {
        start = pivot + 1;
      } else if (diff > 0) {
        end = pivot - 1;
      } else {
        found = true;
        break;
      }
    }
    if (found) {
      return pivot;
    }
    if (exact) {
      return -1;
    }
    // Not exact - insertion point
    return diff < 0 ? pivot + 1 : pivot;
  }

  // Insert element into a sorted array.
  function insertSorted(elem, arr) {
    var idx = findNearest(elem, arr, false);
    arr.splice(idx, 0, elem);
    return arr;
  }

  return {
    /**
     * Get an element at the given position.
     * @memberof Tinode.CBuffer#
     * @param {number} at - Position to fetch from.
     * @returns {Object} Element at the given position or <tt>undefined</tt>
     */
    getAt: function(at) {
      return buffer[at];
    },

    /** Add new element(s) to the buffer. Variadic: takes one or more arguments. If an array is passed as a single
     * argument, its elements are inserted individually.
     * @memberof Tinode.CBuffer#
     *
     * @param {...Object|Array} - One or more objects to insert.
     */
    put: function() {
      var insert;
      // inspect arguments: if array, insert its elements, if one or more non-array arguments, insert them one by one
      if (arguments.length == 1 && Array.isArray(arguments[0])) {
        insert = arguments[0];
      } else {
        insert = arguments;
      }
      for (var idx in insert) {
        insertSorted(insert[idx], buffer);
      }
    },

    /**
     * Remove element at the given position.
     * @memberof Tinode.CBuffer#
     * @param {number} at - Position to delete at.
     * @returns {Object} Element at the given position or <tt>undefined</tt>
     */
    delAt: function(at) {
      var r = buffer.splice(at, 1);
      if (r && r.length > 0) {
        return r[0];
      }
      return undefined;
    },

    /**
     * Remove elements between two positions.
     * @memberof Tinode.CBuffer#
     * @param {number} since - Position to delete from (inclusive).
     * @param {number} before - Position to delete to (exclusive).
     *
     * @returns {Array} array of removed elements (could be zero length).
     */
     delRange: function(since, before) {
       return buffer.splice(since, before-since);
     },

    /**
     * Return the maximum number of element the buffer can hold
     * @memberof Tinode.CBuffer#
     * @return {number} The size of the buffer.
     */
    size: function() {
      return buffer.length;
    },

    /**
     * Discard all elements and reset the buffer to the new size (maximum number of elements).
     * @memberof Tinode.CBuffer#
     * @param {number} newSize - New size of the buffer.
     */
    reset: function(newSize) {
      buffer = [];
    },

    /**
     * Callback for iterating contents of buffer. See {@link Tinode.CBuffer#forEach}.
     * @callback ForEachCallbackType
     * @memberof Tinode.CBuffer#
     * @param {Object} elem - Element of the buffer.
     * @param {number} index - Index of the current element.
     */

    /**
     * Apply given function `callback` to all elements of the buffer.
     * @memberof Tinode.CBuffer#
     *
     * @param {Tinode.ForEachCallbackType} callback - Function to call for each element.
     * @param {integer} startIdx- Optional index to start iterating from (inclusive).
     * @param {integer} beforeIdx - Optional index to stop iterating before (exclusive).
     * @param {Object} context - calling context (i.e. value of 'this' in callback)
     */
    forEach: function(callback, startIdx, beforeIdx, context) {
      startIdx = startIdx | 0;
      beforeIdx = beforeIdx || buffer.length;
      for (var i = startIdx; i < beforeIdx; i++) {
        callback.call(context, buffer[i], i);
      }
    },

    /**
     * Find element in buffer using buffer's comparison function.
     * @memberof Tinode.CBuffer#
     *
     * @param {Object} elem - element to find.
     * @param {boolean=} nearest - when true and exact match is not found, return the nearest element (insertion point).
     * @returns {number} index of the element in the buffer or -1.
     */
    find: function(elem, nearest) {
      return findNearest(elem, buffer, !nearest);
    }
  }
}

// Helper function for creating an endpoint URL
function makeBaseUrl(host, protocol, apiKey) {
  var url = null;

  if (protocol === 'http' || protocol === 'https' || protocol === 'ws' || protocol === 'wss') {
    url = protocol + '://';
    url += host;
    if (url.charAt(url.length - 1) !== '/') {
      url += '/';
    }
    url += "v" + PROTOCOL_VERSION + "/channels";
    if (protocol === "http" || protocol === "https") {
      // Long polling endpoint end with "lp", i.e.
      // '/v0/channels/lp' vs just '/v0/channels' for ws
      url += "/lp";
    }
    url += "?apikey=" + apiKey;
  }

  return url;
}

/**
* An abstraction for a websocket or a long polling connection.
*
* @class Connection
* @memberof Tinode
* @protected
*
* @param {string} transport_ - network transport to use, either `ws`/`wss` for websocket or `lp` for long polling.
* @returns a connection object.
*/
var Connection = (function(transport_, autoreconnect_) {
  var instance;

  var host;
  var secure;
  var apiKey;

  var autoreconnect = autoreconnect_;

  // Settings for exponential backoff
  const _BOFF_BASE = 2000; // 2000 milliseconds, minimum delay between reconnects
  const _BOFF_MAX_ITER = 10; // Maximum delay between reconnects 2^10 * 2000 ~ 34 minutes
  const _BOFF_JITTER = 0.3; // Add random delay

  var _boffTimer = null;
  var _boffIteration = 0;
  var _boffClosed = false; // Indicator if the socket was manually closed - don't autoreconnect if true.

  function log(text) {
    if (instance.logger) {
      instance.logger(text);
    }
  }

  // Reconnect after a timeout.
  function reconnect() {
    // Clear timer
    window.clearTimeout(_boffTimer);
    // Calculate when to fire the reconnect attempt
    var timeout = _BOFF_BASE * (Math.pow(2, _boffIteration) * (1.0 +_BOFF_JITTER * Math.random()));
    // Update iteration counter for future use
    _boffIteration = (_boffIteration >= _BOFF_MAX_ITER ? _boffIteration : _boffIteration + 1);
    _boffTimer = setTimeout(function() {
      console.log("Reconnecting, iter=" + _boffIteration + ", timeout=" + timeout);
      // Maybe the socket was closed while we waited for the timer?
      if (!_boffClosed) {
        instance.connect().catch(function(){/* do nothing */});
      }
    }, timeout);
  }

  // Initialization for Websocket
  function init_ws() {
    var _socket = null;

    return {
      /**
      * Initiate a new connection
      * @memberof Tinode.Connection#
      * @return {Promise} Promise resolved/rejected when the connection call completes,
          resolution is called without parameters, rejection passes the {Error} as parameter.
      */
      connect: function(host_) {
        if (_socket && _socket.readyState === 1) {
          return Promise.resolve();
        }

        if (host_) {
          host = host_;
        }

        return new Promise(function(resolve, reject) {
          var url = makeBaseUrl(host, secure ? "wss" : "ws", apiKey);

          log("Connecting to: " + url);

          var conn = new WebSocket(url);

          conn.onopen = function(evt) {
            _boffClosed = false;

            if (instance.onOpen) {
              instance.onOpen();
            }
            resolve();

            if (autoreconnect) {
              window.clearTimeout(_boffTimer);
              _boffTimer = null;
              _boffIteration = 0;
            }
          }

          conn.onclose = function(evt) {
            _socket = null;

            if (instance.onDisconnect) {
              instance.onDisconnect(null);
            }

            if (!_boffClosed && autoreconnect) {
              reconnect();
            }
          }

          conn.onerror = function(err) {
            reject(err);
          }

          conn.onmessage = function(evt) {
            if (instance.onMessage) {
              instance.onMessage(evt.data);
            }
          }
          _socket = conn;
        });
      },

      /**
       * Terminate the network connection
       * @memberof Tinode.Connection#
       */
      disconnect: function() {
        if (_socket) {
          _boffClosed = true;
          _socket.close();
        }
        _socket = null;
      },

      /**
       * Send a string to the server.
       * @memberof Tinode.Connection#
       *
       * @param {string} msg - String to send.
       * @throws Throws an exception if the underlying connection is not live.
       */
      sendText: function(msg) {
        if (_socket && (_socket.readyState == _socket.OPEN)) {
          _socket.send(msg);
        } else {
          throw new Error("Websocket is not connected");
        }
      },

      /**
       * Check if socket is alive.
       * @memberof Tinode.Connection#
       * @returns {boolean} true if connection is live, false otherwise
       */
      isConnected: function() {
        return (_socket && (_socket.readyState === 1));
      }
    }
  }

  // Initialization for long polling.
  function init_lp() {
    var XDR_UNSENT = 0;   //	Client has been created. open() not called yet.
    var XDR_OPENED = 1;   //	open() has been called.
    var XDR_HEADERS_RECEIVED = 2;	// send() has been called, and headers and status are available.
    var XDR_LOADING = 3;  //	Downloading; responseText holds partial data.
    var XDR_DONE = 4;	    // The operation is complete.
    // Fully composed endpoint URL, with API key & SID
    var _lpURL = null;

    var _poller = null;
    var _sender = null;

    function lp_sender(url_) {
      var sender = xdreq();
      sender.onreadystatechange = function(evt) {
        if (sender.readyState == XDR_DONE && sender.status >= 400) {
          // Some sort of error response
          throw new Error("LP sender failed, " + sender.status);
        }
      }

      sender.open('POST', url_, true);
      return sender;
    }

    function lp_poller(url_, resolve, reject) {
      var poller = xdreq();

      poller.onreadystatechange = function(evt) {

        if (poller.readyState == XDR_DONE) {
          if (poller.status == 201) { // 201 == HTTP.Created, get SID
            var pkt = JSON.parse(poller.responseText, jsonParseHelper);
            var text = poller.responseText;

            _lpURL = url_ + "&sid=" + pkt.ctrl.params.sid
            poller = lp_poller(_lpURL);
            poller.send(null)
            if (instance.onOpen) {
              instance.onOpen();
            }

            if (resolve) {
              resolve();
            }
          } else if (poller.status == 200) { // 200 = HTTP.OK
            if (instance.onMessage) {
              instance.onMessage(poller.responseText)
            }
            poller = lp_poller(_lpURL);
            poller.send(null);
          } else {
            // Don't throw an error here, gracefully handle server errors
            if (reject) {
              reject(poller.responseText);
            }
            if (instance.onMessage) {
              instance.onMessage(poller.responseText);
            }
            if (instance.onDisconnect) {
              instance.onDisconnect(new Error("" + poller.status + " " + poller.responseText));
            }
          }
        }
      }
      poller.open('GET', url_, true);
      return poller;
    }

    return {
      connect: function(host_) {
        if (host_) {
          host = host_;
        }

        return new Promise(function(resolve, reject){
          var url = makeBaseUrl(host, secure ? "https" : "http", apiKey);
          log("Connecting to: " + url);
          _poller = lp_poller(url, resolve, reject);
          _poller.send(null)
        }).catch(function() {
          // Do nothing
        });
      },
      disconnect: function() {
        if (_sender) {
          _sender.abort();
          _sender = null;
        }
        if (_poller) {
          _poller.abort();
          _poller = null;
        }
        if (instance.onDisconnect) {
          instance.onDisconnect(null);
        }
        // Ensure it's reconstructed
        _lpURL = null;
      },
      sendText: function(msg) {
        _sender = lp_sender(_lpURL);
        if (_sender && (_sender.readyState == 1)) { // 1 == OPENED
          _sender.send(msg);
        } else {
          throw new Error("Long poller failed to connect");
        }
      },
      isConnected: function() {
        return (_poller && true);
      }
    };
  }

  if (transport_ === "lp") {
    // explicit request to use long polling
    instance = init_lp();
  } else if (transport_ === "ws") {
    // explicit request to use web socket
    // if websockets are not available, horrible things will happen
    instance = init_ws();
  } else {
    // Default transport selection
    if (!window["WebSocket"]) {
      // The browser has no websockets
      instance = init_lp();
    } else {
      // Using web sockets -- default
      instance = init_ws();
    }
  }

  instance.setup = function(host_, secure_, apiKey_) {
    host = host_;
    secure = secure_;
    apiKey = apiKey_;
  };

  // Callbacks:
  /**
   * A callback to pass incoming messages to. See {@link Tinode.Connection#onMessage}.
   * @callback Tinode.Connection.OnMessage
   * @memberof Tinode.Connection
   * @param {string} message - Message to process.
   */
  /**
  * A callback to pass incoming messages to.
  * @type {Tinode.Connection.OnMessage}
  * @memberof Tinode.Connection#
  */
  instance.onMessage = undefined;

  /**
  * A callback for reporting a dropped connection.
  * @type {function}
  * @memberof Tinode.Connection#
  */
  instance.onDisconnect = undefined;

  /**
   * A callback called when the connection is ready to be used for sending. For websockets it's socket open,
   * for long polling it's readyState=1 (OPENED)
   * @type {function}
   * @memberof Tinode.Connection#
   */
  instance.onOpen = undefined;

 /**
  * A callback to log events from Connection. See {@link Tinode.Connection#logger}.
  * @callback LoggerCallbackType
  * @memberof Tinode.Connection
  * @param {string} event - Event to log.
  */
  /**
  * A callback to report logging events.
  * @memberof Tinode.Connection#
  * @type {Tinode.Connection.LoggerCallbackType}
  */
  instance.logger = undefined;

  return instance;
});


// Core Tinode functionality.
var Tinode = (function() {
  var instance;

  // Initialize Tinode instance
  function init() {
    // Private variables

    // Client-provided application name, format <Name>/<version number>
    var _appName = "Undefined";
    var _platform = "undefined";
    var _browser = '';
    if (typeof navigator != 'undefined') {
      _browser = getBrowserInfo(navigator.userAgent);
      _platform = navigator.platform;
    }
    // Logging to console enabled
    var _loggingEnabled = false;
    // When logging, trip long strings (base64-encoded images) for readability
    var _trimLongStrings = false;
    // A connection object, see Connection above.
    var _connection = null;
    // API Key.
    var _apiKey = null;
    // UID of the currently authenticated user.
    var _myUID = null;
    // Status of connection: authenticated or not.
    var _authenticated = false;
    // Login used in the last successful basic authentication
    var _login = null;
    // Token which can be used for login instead of login/password.
    var _authToken = null;
    // Counter of received packets
    var _inPacketCount = 0;
    // Counter for generating unique message IDs
    var _messageId = 0;
    // Information about the server, if connected
    var _serverInfo = null;

    // Generic cache, currently used for topics/users
    var _cache = {};
    // Cache of pending promises
    var _pendingPromises = {};

    // Private methods

    // Console logger
    function log(str) {
      if (_loggingEnabled) {
        var d = new Date()
        var dateString = ('0' + d.getUTCHours()).slice(-2) + ':' +
          ('0' + d.getUTCMinutes()).slice(-2) + ':' +
          ('0' + d.getUTCSeconds()).slice(-2) + ':' +
          ('0' + d.getUTCMilliseconds()).slice(-3);

        console.log('[' + dateString + '] ' + str);
      }
    }

    // Access to Tinode's cache of objects
    function cachePut(type, name, obj) {
      _cache[type + ":" + name] = obj;
    }

    function cacheGet(type, name) {
      return _cache[type + ":" + name];
    }

    function cacheDel(type, name) {
      delete _cache[type + ":" + name];
    }
    // Enumerate all items in cache, call func for each item.
    // Enumeration stops if func returns true.
    function cacheMap(func, context) {
      for (var idx in _cache) {
        if (func(_cache[idx], idx, context)) {
          break;
        }
      }
    }

    // Make limited cache management available to topic.
    // Caching user.public only. Everything else is per-topic.
    function attachCacheToTopic(topic) {
      topic._cacheGetUser = function(uid) {
        var pub = cacheGet("user", uid);
        if (pub) {
          return {user: uid, public: mergeObj({}, pub)};
        }
        return undefined;
      };
      topic._cachePutUser = function(uid, user) {
        return cachePut("user", uid, mergeObj({}, user.public));
      };
      topic._cacheDelUser = function(uid) {
        return cacheDel("user", uid);
      };
      topic._cachePutSelf = function() {
        return cachePut("topic", topic.name, topic);
      }
      topic._cacheDelSelf = function() {
        return cacheDel("topic", topic.name);
      }
    }

    // Resolve or reject a pending promise.
    // Unresolved promises are stored in _pendingPromises.
    function execPromise(id, code, onOK, errorText) {
      var callbacks = _pendingPromises[id];
      if (callbacks) {
        delete _pendingPromises[id];
        if (code >= 200 && code < 400) {
          if (callbacks.resolve) {
            callbacks.resolve(onOK);
          }
        } else if (callbacks.reject) {
          callbacks.reject(new Error("Error: " + errorText + " (" + code + ")"));
        }
      }
    }

    // Generator of default promises for sent packets
    var makePromise = function(id) {
      var promise = null;
      if (id) {
        var promise = new Promise(function(resolve, reject) {
          // Stored callbacks will be called when the response packet with this Id arrives
          _pendingPromises[id] = {
            "resolve": resolve,
            "reject": reject
          };
        })
      }
      return promise;
    }

    // Generates unique message IDs
    function getNextMessageId() {
      return (_messageId != 0) ? '' + _messageId++ : undefined;
    }

    // Get User Agent string
    function getUserAgent() {
      return _appName + " (" + (_browser ? _browser + "; " : "") + _platform + "); " + LIBRARY;
    }

    // Generator of packets stubs
    function initPacket(type, topic) {
      var pkt = null;
      switch (type) {
        case "hi":
          return {
            "hi": {
              "id": getNextMessageId(),
              "ver": VERSION,
              "ua": getUserAgent(),
            }
          };

        case "acc":
          return {
            "acc": {
              "id": getNextMessageId(),
              "user": null,
              "scheme": null,
              "secret": null,
              "login": false,
              "tags": null,
              "desc": {},
              "cred": {}
            }
          };

        case "login":
          return {
            "login": {
              "id": getNextMessageId(),
              "scheme": null,
              "secret": null
            }
          };

        case "sub":
          return {
            "sub": {
              "id": getNextMessageId(),
              "topic": topic,
              "set": {},
              "get": {}
            }
          };

        case "leave":
          return {
            "leave": {
              "id": getNextMessageId(),
              "topic": topic,
              "unsub": false
            }
          };

        case "pub":
          return {
            "pub": {
              "id": getNextMessageId(),
              "topic": topic,
              "noecho": false,
              "head": null,
              "content": {}
            }
          };

        case "get":
          return {
            "get": {
              "id": getNextMessageId(),
              "topic": topic,
              "what": null, // data, sub, desc, space separated list; unknown strings are ignored
              "desc": {},
              "sub": {},
              "data": {}
            }
          };

        case "set":
          return {
            "set": {
              "id": getNextMessageId(),
              "topic": topic,
              "desc": {},
              "sub": {},
              "tags": []
            }
          };

        case "del":
          return {
            "del": {
              "id": getNextMessageId(),
              "topic": topic,
              "what": null,
              "delseq": null,
              "user": null,
              "hard": false
            }
          };

        case "note":
          return {
            "note": {
              // no id by design
              "topic": topic,
              "what": null, // one of "recv", "read", "kp"
              "seq": undefined // the server-side message id aknowledged as received or read
            }
          };

        default:
          throw new Error("Unknown packet type requested: " + type);
      }
    }

    // Send a packet. If packet id is provided return a promise.
    function send(pkt, id) {
      let promise;
      if (id) {
        promise = makePromise(id);
      }
      pkt = simplify(pkt);
      var msg = JSON.stringify(pkt);
      log("out: " + (_trimLongStrings ? JSON.stringify(pkt, jsonLoggerHelper) : msg));
      _connection.sendText(msg);
      return promise;
    }

    // The main message dispatcher.
    function dispatchMessage(data) {
      // Skip empty response. This happens when LP times out.
      if (!data) return;

      _inPacketCount++;

      // Send raw message to listener
      if (instance.onRawMessage) {
        instance.onRawMessage(data);
      }

      var pkt = JSON.parse(data, jsonParseHelper);
      if (!pkt) {
        log("in: " + data);
        log("ERROR: failed to parse data");
      } else {
        log("in: " + (_trimLongStrings ? JSON.stringify(pkt, jsonLoggerHelper) : data));

        // Send complete packet to listener
        if (instance.onMessage) {
          instance.onMessage(pkt);
        }

        if (pkt.ctrl) {
          // Handling {ctrl} message
          if (instance.onCtrlMessage) {
            instance.onCtrlMessage(pkt.ctrl);
          }

          // Resolve or reject a pending promise, if any
          if (pkt.ctrl.id) {
            execPromise(pkt.ctrl.id, pkt.ctrl.code, pkt.ctrl, pkt.ctrl.text);
          }
        } else if (pkt.meta) {
          // Handling a {meta} message.

          // Preferred API: Route meta to topic, if one is registered
          var topic = cacheGet("topic", pkt.meta.topic);
          if (topic) {
            topic._routeMeta(pkt.meta);
          }

          // Secondary API: callback
          if (instance.onMetaMessage) {
            instance.onMetaMessage(pkt.meta);
          }
        } else if (pkt.data) {
          // Handling {data} message

          // Preferred API: Route data to topic, if one is registered
          var topic = cacheGet("topic", pkt.data.topic);
          if (topic) {
            topic._routeData(pkt.data);
          }

          // Secondary API: Call callback
          if (instance.onDataMessage) {
            instance.onDataMessage(pkt.data);
          }
        } else if (pkt.pres) {
          // Handling {pres} message

          // Preferred API: Route presence to topic, if one is registered
          var topic = cacheGet("topic", pkt.pres.topic);
          if (topic) {
            topic._routePres(pkt.pres);
          }

          // Secondary API - callback
          if (instance.onPresMessage) {
            instance.onPresMessage(pkt.pres);
          }
        } else if (pkt.info) {
          // {info} message - read/received notifications and key presses

          // Preferred API: Route {info}} to topic, if one is registered
          var topic = cacheGet("topic", pkt.info.topic);
          if (topic) {
            topic._routeInfo(pkt.info);
          }

          // Secondary API - callback
          if (instance.onInfoMessage) {
            instance.onInfoMessage(pkt.info);
          }
        } else {
          log("ERROR: Unknown packet received.");
        }
      }
    }

    function handleReadyToSend() {
      instance.hello();
    }

    function handleDisconnect(err) {
      _inPacketCount = 0;
      _serverInfo = null;
      _authenticated = false;

      cacheMap(function(obj, key) {
        if (key.lastIndexOf("topic:", 0) === 0) {
          obj._resetSub();
        }
      });

      if (instance.onDisconnect) {
        instance.onDisconnect(err);
      }
    }

    function loginSuccessful(ctrl) {
      // This is a response to a successful login,
      // extract UID and security token, save it in Tinode module
      _myUID = ctrl.params.user;
      _authenticated = (ctrl && ctrl.code >= 200 && ctrl.code < 300);
      if (ctrl.params && ctrl.params.token && ctrl.params.expires) {
        _authToken = {
          token: ctrl.params.token,
          expires: new Date(ctrl.params.expires)
        };
      } else {
        _authToken = null;
      }

      if (instance.onLogin) {
        instance.onLogin(ctrl.code, ctrl.text);
      }
    }
    // Returning an initialized instance with public methods;
    return {

      /** Instance configuration. Can be calle dmultiple times.
       * @memberof Tinode#
       *
       * @param {string} appname - Name of the caliing application to be reported in User Agent.
       * @param {string} host - Host name and port number to connect to.
       * @param {string} apiKey - API key generated by keygen
       * @param {string} transport - See {@link Tinode.Connection#transport}.
       */
      setup: function(appname_, host_, apiKey_, transport_) {
        // Initialize with a random id each time, to avoid confusing with packets
        // from a previous session.
        _messageId = Math.floor((Math.random() * 0xFFFF) + 0xFFFF);

        if (appname_) {
          _appName = appname_;
        } else {
          _appName = "Undefined";
        }

        _apiKey = apiKey_;

        _myUID = null;
        _authenticated = false;
        _login = null;
        _authToken = null;
        _inPacketCount = 0;
        _serverInfo = null;

        _cache = {};
        _pendingPromises = {};

        if (_connection) {
          _connection.disconnect();
        }

        _connection = Connection(transport_, true);
        _connection.logger = log;
        _connection.onMessage = dispatchMessage;
        _connection.onDisconnect = handleDisconnect;
        _connection.onOpen = handleReadyToSend;
        _connection.setup(host_, (location.protocol == 'https:'), apiKey_);
      },

      /**
       * Connect to the server.
       * @memberof Tinode#
       *
       * @param {String} host_ - name of the host to connect to.
       *
       * @return {Promise} Promise resolved/rejected when the connection call completes:
       * <tt>resolve()</tt> is called without parameters, <tt>reject()</tt> receives the <tt>Error</tt> as a single parameter.
       */
      connect: function(host_) {
        return _connection.connect(host_);
      },

      /**
       * Disconnect from the server.
       * @memberof Tinode#
       */
      disconnect: function() {
        if (_connection) {
          _connection.disconnect();
        }
      },

      /**
      * Check for live connection to server
      * @memberof Tinode#
      *
      * @returns {Boolean} true if there is a live connection, false otherwise.
      */
      isConnected: function() {
        return _connection && _connection.isConnected();
      },
      /**
      * Check if connection is authenticated (last login was successful).
      * @memberof Tinode#
      * @returns {boolean} true if authenticated, false otherwise.
      */
      isAuthenticated: function() {
        return _authenticated;
      },

      /**
       * @typedef AccountCreationParams
       * @memberof Tinode
       * @type Object
       * @property {Tinode.DefAcs=} defacs - Default access parameters for user's <tt>me</tt> topic.
       * @property {Object=} public - Public application-defined data exposed on <tt>me</tt> topic.
       * @property {Object=} private - Private application-defined data accessible on <tt>me</tt> topic.
       * @property {Array} tags - array of string tags for user discovery.
       */
      /**
       * @typedef DefAcs
       * @memberof Tinode
       * @type Object
       * @property {string=} auth - Access mode for <tt>me</tt> for authenticated users.
       * @property {string=} anon - Access mode for <tt>me</tt>  anonymous users.
       */

       /**
        * Create or update an account.
        * @memberof Tinode#
        *
        * @param {String} uid - User id to update
        * @param {String} scheme - Authentication scheme; <tt>"basic"</tt> is the only currently supported scheme.
        * @param {String} secret - Authentication secret, assumed to be already base64 encoded.
        * @param {Boolean=} login - Use new account to authenticate current session
        * @param {Tinode.AccountCreationParams=} params - User data to pass to the server.
        */
       account: function(uid, scheme, secret, login, params) {
         var pkt = initPacket("acc");
         pkt.acc.user = uid;
         pkt.acc.scheme = scheme;
         pkt.acc.secret = secret;
         // Log in to the new account using selected scheme
         pkt.acc.login = login;

         if (params) {
           pkt.acc.desc.defacs = params.defacs;
           pkt.acc.desc.public = params.public;
           pkt.acc.desc.private = params.private;

           pkt.acc.tags = params.tags;
           pkt.acc.cred = params.cred;
         }

         return send(pkt, pkt.acc.id);
       },

      /**
       * Create a new user. Wrapper for {@link Tinode#account}.
       * @memberof Tinode#
       *
       * @param {String} scheme - Authentication scheme; <tt>"basic"</tt> is the only currently supported scheme.
       * @param {String} secret - Authentication.
       * @param {Boolean=} login - Use new account to authenticate current session
       * @param {Tinode.AccountCreationParams=} params - User data to pass to the server.
       *
       * @returns {Promise} Promise which will be resolved/rejected when server reply is received.
       */
      createAccount: function(scheme, secret, login, params) {
        var promise = instance.account(USER_NEW, scheme, secret, login, params);
        if (login) {
          promise = promise.then(function(ctrl) {
            loginSuccessful(ctrl);
            return ctrl;
          });
        }
        return promise;
      },

      /**
       * Create user with 'basic' authentication scheme and immediately
       * use it for authentication. Wrapper for {@link Tinode#account}.
       * @memberof Tinode#
       *
       * @param {string} username - Login to use for the new account.
       * @param {string} password - User's password.
       * @param {Tinode.AccountCreationParams=} params - User data to pass to the server.
       *
       * @returns {Promise} Promise which will be resolved/rejected when server reply is received.
       */
      createAccountBasic: function(username, password, params) {
        // Make sure we are not using 'null' or 'undefined';
        username = username || '';
        password = password || '';
        return instance.createAccount("basic",
          b64EncodeUnicode(username + ":" + password), true, params);
      },

      /**
       * Update user's credentials for 'basic' authentication scheme. Wrapper for {@link Tinode#account}.
       * @memberof Tinode#
       *
       * @param {string} uid - User ID to update.
       * @param {string} username - Login to use for the new account.
       * @param {string} password - User's password.
       *
       * @returns {Promise} Promise which will be resolved/rejected when server reply is received.
       */
      updateAccountBasic: function(uid, username, password) {
        // Make sure we are not using 'null' or 'undefined';
        username = username || '';
        password = password || '';
        return instance.account(uid, "basic",
          b64EncodeUnicode(username + ":" + password), false, null);
      },

      /**
       * Helper method to add account credential to an object.
       * @memberof Tinode#
       *
       * @param {Object} obj - Object to modify. A new object will be allocated if obj is null or undefined.
       * @param {String|Object} meth - validation method or object with validation data.
       * @param {String=} val - validation value (e.g. email or phone number).
       * @param {Object=} params - validation parameters.
       * @param {String=} resp - validation response.
       *
       * @returns {Object} Modified object
       */
      addCredential: function(obj, meth, val, params, resp) {
        if (typeof meth == 'object') {
          ({val, params, resp, meth} = meth);
        };
        if (meth && (val || resp)) {
          if (!obj) {
            obj = {};
          }
          if (!obj.cred) {
            obj.cred = [];
          }
          obj.cred.push({
            "meth": meth,
            "val": val,
            "resp": resp,
            "params": params
          });
        }
        return obj;
      },
      /**
       * Send handshake to the server.
       * @memberof Tinode#
       *
       * @returns {Promise} Promise which will be resolved/rejected when server reply is received.
       */
      hello: function() {
        var pkt = initPacket("hi");

        return send(pkt, pkt.hi.id)
          .then(function(ctrl) {
            // Server response contains server protocol version, build,
            // and session ID for long polling. Save them.
            if (ctrl.params) {
              _serverInfo = ctrl.params;
            }

            if (instance.onConnect) {
              instance.onConnect();
            }

            return ctrl;
          }).catch(function(err) {
            if (instance.onDisconnect) {
              instance.onDisconnect(err);
            }
          });
      },

      /**
       * Authenticate current session.
       * @memberof Tinode#
       *
       * @param {String} scheme - Authentication scheme; <tt>"basic"</tt> is the only currently supported scheme.
       * @param {String} secret - Authentication secret, assumed to be already base64 encoded.
       *
       * @returns {Promise} Promise which will be resolved/rejected when server reply is received.
       */
      login: function(scheme, secret, cred) {
        var pkt = initPacket("login");
        pkt.login.scheme = scheme;
        pkt.login.secret = secret;
        pkt.login.cred = cred;

        return send(pkt, pkt.login.id)
          .then(function(ctrl) {
            loginSuccessful(ctrl);
            return ctrl;
          });
      },

      /**
       * Wrapper for {@link Tinode#login} with basic authentication
       * @memberof Tinode#
       *
       * @param {String} uname - User name.
       * @param {String} password  - Password.
       * @returns {Promise} Promise which will be resolved/rejected on receiving server reply.
       */
      loginBasic: function(uname, password, cred) {
        return instance.login("basic", b64EncodeUnicode(uname + ":" + password), cred)
          .then(function(ctrl) {
            _login = uname;
            return ctrl;
          });
      },

      /**
       * Wrapper for {@link Tinode#login} with token authentication
       * @memberof Tinode#
       *
       * @param {String} token - Token received in response to earlier login.
       * @returns {Promise} Promise which will be resolved/rejected on receiving server reply.
       */
      loginToken: function(token, cred) {
        return instance.login("token", token, cred);
      },

      /**
       * @typedef AuthToken
       * @memberof Tinode
       * @type Object
       * @property {String} token - Token value.
       * @property {Date} expires - Token expiration time.
       */
      /**
       * Get stored authentication token.
       * @memberof Tinode#
       *
       * @returns {Tinode.AuthToken} authentication token.
       */
      getAuthToken: function() {
        if (_authToken && (_authToken.expires.getTime() > Date.now())) {
          return _authToken;
        } else {
          _authToken = null;
        }
        return null;
      },

      /**
       * Application may provide a saved authentication token.
       * @memberof Tinode#
       *
       * @param {Tinode.AuthToken} token - authentication token.
       */
      setAuthToken: function(token) {
        _authToken = token;
      },

      /**
       * @typedef SetParams
       * @memberof Tinode
       * @property {Tinode.SetDesc=} desc - Topic initialization parameters when creating a new topic or a new subscription.
       * @property {Tinode.SetSub=} sub - Subscription initialization parameters.
       */
     /**
      * @typedef SetDesc
      * @memberof Tinode
      * @property {Tinode.DefAcs=} defacs - Default access mode.
      * @property {Object=} public - Free-form topic description, publically accessible.
      * @property {Object=} private - Free-form topic descriptionaccessible only to the owner.
      */
      /**
       * @typedef SetSub
       * @memberof Tinode
       * @property {String=} user - UID of the user affected by the request. Default (empty) - current user.
       * @property {String=} mode - User access mode, either requested or assigned dependent on context.
       * @property {Object=} info - Free-form payload to pass to the invited user or topic manager.
       */
      /**
       * Parameters passed to {@link Tinode#subscribe}.
       *
       * @typedef SubscriptionParams
       * @memberof Tinode
       * @property {Tinode.SetParams=} set - Parameters used to initialize topic
       * @property {Tinode.GetQuery=} get - Query for fetching data from topic.
       */

      /**
       * Send a topic subscription request.
       * @memberof Tinode#
       *
       * @param {String} topic - Name of the topic to subscribe to.
       * @param {Tinode.GetQuery=} getParams - Optional subscription metadata query
       * @param {Tinode.SetParams=} setParams - Optional initialization parameters
       *
       * @returns {Promise} Promise which will be resolved/rejected on receiving server reply.
       */
      subscribe: function(topicName, getParams, setParams) {
        var pkt = initPacket("sub", topicName)
        if (!topicName) {
          topicName = TOPIC_NEW;
        }

        pkt.sub.get = getParams;

        if (setParams) {
          if (setParams.sub) {
            pkt.sub.set.sub = setParams.sub;
          }

          if (topicName === TOPIC_NEW && setParams.desc) {
            // set.desc params are used for new topics only
            pkt.sub.set.desc = setParams.desc
          }

          if (setParams.tags) {
            pkt.sub.set.tags = setParams.tags;
          }
        }

        return send(pkt, pkt.sub.id);
      },

      /**
       * Detach and optionally unsubscribe from the topic
       * @memberof Tinode#
       *
       * @param {String} topic - Topic to detach from.
       * @param {Boolean} unsub - If <tt>true</tt>, detach and unsubscribe, otherwise just detach.
       *
       * @returns {Promise} Promise which will be resolved/rejected on receiving server reply.
       */
      leave: function(topic, unsub) {
        var pkt = initPacket("leave", topic);
        pkt.leave.unsub = unsub;

        return send(pkt, pkt.leave.id);
      },

      /**
       * Create message draft without sending it to the server.
       * @memberof Tinode#
       *
       * @param {String} topic - Name of the topic to publish to.
       * @param {Object} data - Payload to publish.
       * @param {Boolean=} noEcho - If <tt>true</tt>, tell the server not to echo the message to the original session.
       * @param {String=} mimeType - Mime-type of the data. Implicit default is 'text/plain'.
       * @param {Array=} attachments - array of strings containing URLs of files attached to the message.
       *
       * @returns {Object} new message which can be sent to the server or otherwise used.
       */
      createMessage: function(topic, data, noEcho, mimeType, attachments) {
        var pkt = initPacket("pub", topic);
        pkt.pub.noecho = noEcho;
        pkt.pub.content = data;

        if (mimeType || Array.isArray(attachments)) {
          pkt.pub.head = { mime: mimeType, attachments: attachments };
        }
        return pkt.pub;
      },

      /**
       * Publish {data} message to topic.
       * @memberof Tinode#
       *
       * @param {String} topic - Name of the topic to publish to.
       * @param {Object} data - Payload to publish.
       * @param {Boolean=} noEcho - If <tt>true</tt>, tell the server not to echo the message to the original session.
       * @param {String=} mimeType - Mime-type of the data. Implicit default is 'text/plain'.
       * @param {Array=} attachments - array of strings containing URLs of files attached to the message.
       *
       * @returns {Promise} Promise which will be resolved/rejected on receiving server reply.
       */
      publish: function(topic, data, noEcho, mimeType, attachments) {
        return instance.publishMessage(
          instance.createMessage(topic, data, noEcho, mimeType, attachments)
        );
      },

      /**
       * Publish message to topic. The message should be created by {@link Tinode#createMessage}.
       * @memberof Tinode#
       *
       * @param {Object} pub - Message to publish.
       *
       * @returns {Promise} Promise which will be resolved/rejected on receiving server reply.
       */
      publishMessage: function(pub) {
        // Make a shallow copy. Needed in order to clear locally-assigned temp values;
        pub = Object.assign({}, pub);
        pub.seq = undefined;
        pub.from = undefined;
        pub.ts = undefined;
        return send({pub: pub}, pub.id);
      },

      /**
       * @typedef GetQuery
       * @type Object
       * @memberof Tinode
       * @property {Tinode.GetOptsType=} desc - If provided (even if empty), fetch topic description.
       * @property {Tinode.GetOptsType=} sub - If provided (even if empty), fetch topic subscriptions.
       * @property {Tinode.GetDataType=} data - If provided (even if empty), get messages.
       */

      /**
       * @typedef GetOptsType
       * @type Object
       * @memberof Tinode
       * @property {Date=} ims - "If modified since", fetch data only it was was modified since stated date.
       * @property {Number=} limit - Maximum number of results to return. Ignored when querying topic description.
       */

       /**
        * @typedef GetDataType
        * @type Object
        * @memberof Tinode
        * @property {Number=} since - Load messages with seq id equal or greater than this value.
        * @property {Number=} before - Load messages with seq id lower than this number.
        * @property {Number=} limit - Maximum number of results to return.
        */

      /**
       * Request topic metadata
       * @memberof Tinode#
       *
       * @param {String} topic - Name of the topic to query.
       * @param {Tinode.GetQuery} params - Parameters of the query. Use {Tinode.MetaGetBuilder} to generate.
       *
       * @returns {Promise} Promise which will be resolved/rejected on receiving server reply.
       */
      getMeta: function(topic, params) {
        var pkt = initPacket("get", topic);

        pkt.get = mergeObj(pkt.get, params);

        return send(pkt, pkt.get.id);
      },

      /**
       * Update topic's metadata: description, subscribtions.
       * @memberof Tinode#
       *
       * @param {String} topic - Topic to update.
       * @param {Tinode.SetParams} params - topic metadata to update.
       * @returns {Promise} Promise which will be resolved/rejected on receiving server reply.
       */
      setMeta: function(topic, params) {
        var pkt = initPacket("set", topic);
        var what = [];

        if (params) {
          ["desc", "sub", "tags"].map(function(key){
            if (params.hasOwnProperty(key)) {
              what.push(key);
              pkt.set[key] = params[key];
            }
          });
        }

        if (what.length == 0) {
          return Promise.reject(new Error("Invalid {set} parameters"));
        }

        return send(pkt, pkt.set.id);
      },

      /**
       * Range of message IDs to delete.
       *
       * @typedef DelRange
       * @type Object
       * @memberof Tinode
       * @property {Number} low - low end of the range, inclusive (closed).
       * @property {Number=} hi - high end of the range, exclusive (open).
       */
      /**
       * Delete some or all messages in a topic.
       * @memberof Tinode#
       *
       * @param {String} topic - Topic name to delete messages from.
       * @param {Tinode.DelRange[]} list - Ranges of message IDs to delete.
       * @param {Boolean=} hard - Hard or soft delete
       *
       * @returns {Promise} Promise which will be resolved/rejected on receiving server reply.
       */
      delMessages: function(topic, ranges, hard) {
        var pkt = initPacket("del", topic);

        pkt.del.what = "msg";
        pkt.del.delseq = ranges;
        pkt.del.hard = hard;

        return send(pkt, pkt.del.id);
      },

      /**
       * Delete the topic alltogether. Requires Owner permission.
       * @memberof Tinode#
       *
       * @param {String} topic - Name of the topic to delete
       * @returns {Promise} Promise which will be resolved/rejected on receiving server reply.
       */
      delTopic: function(topic) {
        var pkt = initPacket("del", topic);
        pkt.del.what = "topic";

        return send(pkt, pkt.del.id).then(function(ctrl) {
          cacheDel("topic", topic);
          return ctrl;
        });
      },

      /**
       * Delete subscription. Requires Share permission.
       * @memberof Tinode#
       *
       * @param {String} topic - Name of the topic to delete
       * @param {String} user - User ID to remove.
       * @returns {Promise} Promise which will be resolved/rejected on receiving server reply.
       */
      delSubscription: function(topic, user) {
        var pkt = initPacket("del", topic);
        pkt.del.what = "sub";
        pkt.del.user = user;

        return send(pkt, pkt.del.id);
      },

      /**
       * Notify server that a message or messages were read or received. Does NOT return promise.
       * @memberof Tinode#
       *
       * @param {String} topic - Name of the topic where the mesage is being aknowledged.
       * @param {String} what - Action being aknowledged, either "read" or "recv".
       * @param {Number} seq - Maximum id of the message being acknowledged.
       */
      note: function(topic, what, seq) {
        if (seq <= 0 || seq >= LOCAL_SEQID) {
          console.log("Invalid message id " + seq);
          return;
        }
        var pkt = initPacket("note", topic);
        pkt.note.what = what;
        pkt.note.seq = seq;
        send(pkt);
      },

      /**
       * Broadcast a key-press notification to topic subscribers. Used to show
       * typing notifications "user X is typing...".
       * @memberof Tinode#
       *
       * @param {String} topic - Name of the topic to broadcast to.
       */
      noteKeyPress: function(topic) {
        var pkt = initPacket("note", topic);
        pkt.note.what = "kp";
        send(pkt);
      },

      /**
       * Get a named topic, either pull it from cache or create a new instance.
       * There is a single instance of topic for each name.
       * @memberof Tinode#
       *
       * @param {String} topic - Name of the topic to get.
       * @returns {Tinode.Topic} Requested or newly created topic or <tt>undefined</tt> if topic name is invalid.
       */
      getTopic: function(name) {
        var topic = cacheGet("topic", name);
        if (!topic && name) {
          if (name === TOPIC_ME) {
            topic = new TopicMe();
          } else if (name === TOPIC_FND) {
            topic = new TopicFnd();
          } else {
            topic = new Topic(name);
          }
          topic._new = false;
          cachePut("topic", name, topic);
        }
        if (topic) {
          attachCacheToTopic(topic);
        }
        return topic;
      },

      /**
       * Instantiate a new unnamed topic. Name will be assigned by the server on {@link Tinode.Topic.subscribe}.
       * @memberof Tinode#
       *
       * @param {Tinode.Callbacks} callbacks - Object with callbacks for various events.
       * @returns {Tinode.Topic} Newly created topic.
       */
      newTopic: function(callbacks) {
        var topic = new Topic(undefined, callbacks);
        attachCacheToTopic(topic);
        return topic;
      },

      /**
       * Instantiate a new P2P topic with a given peer.
       * @memberof Tinode#
       *
       * @param {string} peer - UId of the peer to start topic with.
       * @param {Tinode.Callbacks} callbacks - Object with callbacks for various events.
       * @returns {Tinode.Topic} Newly created topic.
       */
      newTopicWith: function(peer, callbacks) {
        var topic = new Topic(peer, callbacks);
        attachCacheToTopic(topic);
        return topic;
      },

      /**
       * Instantiate 'me' topic or get it from cache.
       * @memberof Tinode#
       *
       * @returns {Tinode.TopicMe} Instance of 'me' topic.
       */
      getMeTopic: function() {
        return instance.getTopic(TOPIC_ME);
      },

      /**
       * Instantiate 'fnd' (find) topic or get it from cache.
       * @memberof Tinode#
       *
       * @returns {Tinode.Topic} Instance of 'fnd' topic.
       */
      getFndTopic: function() {
        return instance.getTopic(TOPIC_FND);
      },

      /**
       * Create a new LargeFileHelper instance
       * @memberof Tinode#
       *
       * @returns {Tinode.LargeFileHelper} instance of a LargeFileHelper.
       */
      getLargeFileHelper: function() {
        var token = instance.getAuthToken();
        return token ? new LargeFileHelper(_apiKey, token.token, getNextMessageId()) : null;
      },

      /**
       * Get the UID of the the current authenticated user.
       * @memberof Tinode#
       * @returns {string} UID of the current user or <tt>undefined</tt> if the session is not yet authenticated or if there is no session.
       */
      getCurrentUserID: function() {
        return _myUID;
      },

      /**
       * Get login used for last successful authentication.
       * @memberof Tinode#
       * @returns {string} login last used successfully or <tt>undefined</tt>.
       */
      getCurrentLogin: function() {
        return _login;
      },

      /**
       * Return information about the server: protocol version and build timestamp.
       * @memberof Tinode#
       * @returns {Object} build and version of the server or <tt>null</tt> if there is no connection or if the first server response has not been received yet.
       */
      getServerInfo: function() {
        return _serverInfo;
      },

      /**
       * Return information about the current version of this Tinode client library.
       * @memberof Tinode#
       * @returns {string} current version in the MAJOR.MINOR format, e.g. '0.8'.
       */
      getVersion: function() {
        return VERSION;
      },

      /**
       * Toggle console logging. Logging is off by default.
       * @memberof Tinode#
       * @param {boolean} enabled - Set to <tt>true</tt> to enable logging to console.
       */
      enableLogging: function(enabled, trimLongStrings) {
        _loggingEnabled = enabled;
        _trimLongStrings = trimLongStrings;
      },

      /**
       * Determine topic type from topic's name: grp, p2p, me, fnd.
       * @memberof Tinode
       *
       * @param {string} name - Name of the topic to test.
       * @returns {string} One of <tt>'me'</tt>, <tt>'grp'</tt>, <tt>'p2p'</tt> or <tt>undefined</tt>.
       */
      topicType: function(name) {
        var types = {
          'me': 'me', 'fnd': 'fnd',
          'grp': 'grp', 'new': 'grp',
          'usr': 'p2p'
        };
        var tp = (typeof name === "string") ? name.substring(0, 3) : 'xxx';
        return types[tp];
      },

      /**
       * Check if given topic is online.
       * @memberof Tinode#
       *
       * @param {String} name - Name of the topic to test.
       * @returns {Boolean} true if topic is online, false otherwise.
       */
      isTopicOnline: function(name) {
        var me = instance.getTopic(TOPIC_ME);
        var cont = me && me.getContact(name);
        return cont && cont.online;
      },

      /**
       * Include message ID into all subsequest messages to server instructin it to send aknowledgemens.
       * Required for promises to function. Default is "on".
       * @memberof Tinode#
       *
       * @param {Boolean} status - Turn aknowledgemens on or off.
       * @deprecated
       */
      wantAkn: function(status) {
        if (status) {
          _messageId = Math.floor((Math.random() * 0xFFFFFF) + 0xFFFFFF);
        } else {
          _messageId = 0;
        }
      },

      // Callbacks:
       /**
       * Callback to report when the websocket is opened. The callback has no parameters.
       * @memberof Tinode#
       * @type {Tinode.onWebsocketOpen}
       */
      onWebsocketOpen: undefined,

      /**
       * @typedef Tinode.ServerParams
       * @memberof Tinode
       * @type Object
       * @property {string} ver - Server version
       * @property {string} build - Server build
       * @property {string=} sid - Session ID, long polling connections only.
       */

      /**
       * @callback Tinode.onConnect
       * @param {number} code - Result code
       * @param {string} text - Text epxplaining the completion, i.e "OK" or an error message.
       * @param {Tinode.ServerParams} params - Parameters returned by the server.
       */
      /**
       * Callback to report when connection with Tinode server is established.
       * @memberof Tinode#
       * @type {Tinode.onConnect}
       */
      onConnect: undefined,

      /**
       * Callback to report when connection is lost. The callback has no parameters.
       * @memberof Tinode#
       * @type {Tinode.onDisconnect}
       */
      onDisconnect: undefined,

      /**
       * @callback Tinode.onLogin
       * @param {number} code - NUmeric completion code, same as HTTP status codes.
       * @param {string} text - Explanation of the completion code.
       */
      /**
       * Callback to report login completion.
       * @memberof Tinode#
       * @type {Tinode.onLogin}
       */
      onLogin: undefined,

      /**
       * Callback to receive {ctrl} (control) messages.
       * @memberof Tinode#
       * @type {Tinode.onCtrlMessage}
       */
      onCtrlMessage: undefined,

      /**
       * Callback to recieve {data} (content) messages.
       * @memberof Tinode#
       * @type {Tinode.onDataMessage}
       */
      onDataMessage: undefined,

      /**
       * Callback to receive {pres} (presence) messages.
       * @memberof Tinode#
       * @type {Tinode.onPresMessage}
       */
      onPresMessage: undefined,

      /**
       * Callback to receive all messages as objects.
       * @memberof Tinode#
       * @type {Tinode.onMessage}
       */
      onMessage: undefined,

      /**
       * Callback to receive all messages as unparsed text.
       * @memberof Tinode#
       * @type {Tinode.onRawMessage}
       */
      onRawMessage: undefined,

      // Exported constants
      MESSAGE_STATUS_NONE:     MESSAGE_STATUS_NONE,
      MESSAGE_STATUS_QUEUED:   MESSAGE_STATUS_QUEUED,
      MESSAGE_STATUS_SENDING:  MESSAGE_STATUS_SENDING,
      MESSAGE_STATUS_SENT:     MESSAGE_STATUS_SENT,
      MESSAGE_STATUS_RECEIVED: MESSAGE_STATUS_RECEIVED,
      MESSAGE_STATUS_READ:     MESSAGE_STATUS_READ,
      MESSAGE_STATUS_TO_ME:    MESSAGE_STATUS_TO_ME,
    };
  }

  return {
    // Get the Singleton instance if one exists or create one if it doesn't.
    getInstance: function() {
      if (!instance) {
        instance = init();
      }
      return instance;
    }
  };
})();

/**
 * Helper class for constructing {@link Tinode.GetQuery}.
 *
 * @class MetaGetBuilder
 * @memberof Tinode
 *
 * @param {Tinode.Topic} parent topic which instantiated this builder.
 */
var MetaGetBuilder = function(parent) {
  this.topic = parent;
  this.what = {};
}

MetaGetBuilder.prototype = {

  /**
   * Add query parameters to fetch messages within explicit limits.
   * @memberof Tinode.MetaGetBuilder#
   *
   * @param {Number=} since messages newer than this (inclusive);
   * @param {Number=} before older than this (exclusive)
   * @param {Number=} limit number of messages to fetch
   * @returns {Tinode.MetaGetBuilder} <tt>this</tt> object.
   */
  withData: function(since, before, limit) {
    this.what["data"] = {since: since, before: before, limit: limit};
    return this;
  },

  /**
   * Add query parameters to fetch messages newer than the latest saved message.
   * @memberof Tinode.MetaGetBuilder#
   *
   * @param {Number=} limit number of messages to fetch
   *
   * @returns {Tinode.MetaGetBuilder} <tt>this</tt> object.
   */
  withLaterData: function(limit) {
    return this.withData(this.topic._maxSeq > 0 ? this.topic._maxSeq + 1 : undefined, undefined, limit);
  },

  /**
   * Add query parameters to fetch messages older than the earliest saved message.
   * @memberof Tinode.MetaGetBuilder#
   *
   * @param {Number=} limit maximum number of messages to fetch.
   *
   * @returns {Tinode.MetaGetBuilder} <tt>this</tt> object.
   */
  withEarlierData: function(limit) {
    return this.withData(undefined, this.topic._minSeq > 0 ? this.topic._minSeq : undefined, limit);
  },

  /**
   * Add query parameters to fetch topic description if it's newer than the given timestamp.
   * @memberof Tinode.MetaGetBuilder#
   *
   * @param {Date=} ims fetch messages newer than this timestamp.
   *
   * @returns {Tinode.MetaGetBuilder} <tt>this</tt> object.
   */
  withDesc: function(ims) {
    this.what["desc"] = {ims: ims};
    return this;
  },

  /**
   * Add query parameters to fetch topic description if it's newer than the last update.
   * @memberof Tinode.MetaGetBuilder#
   *
   * @returns {Tinode.MetaGetBuilder} <tt>this</tt> object.
   */
  withLaterDesc: function() {
    return this.withDesc(this.topic._lastDescUpdate);
  },

  /**
   * Add query parameters to fetch subscriptions.
   * @memberof Tinode.MetaGetBuilder#
   *
   * @param {Date=} ims fetch subscriptions modified more recently than this timestamp
   * @param {Number=} limit maximum number of subscriptions to fetch.
   * @param {String=} userOrTopic user ID or topic name to fetch for fetching one subscription.
   *
   * @returns {Tinode.MetaGetBuilder} <tt>this</tt> object.
   */
  withSub: function(ims, limit, userOrTopic) {
    var opts = {ims: ims, limit: limit};
    if (this.topic.getType() == 'me') {
      opts.topic = userOrTopic;
    } else {
      opts.user = userOrTopic;
    }
    this.what["sub"] = opts;
    return this;
  },

  /**
   * Add query parameters to fetch a single subscription.
   * @memberof Tinode.MetaGetBuilder#
   *
   * @param {Date=} ims fetch subscriptions modified more recently than this timestamp
   * @param {String=} userOrTopic user ID or topic name to fetch for fetching one subscription.
   *
   * @returns {Tinode.MetaGetBuilder} <tt>this</tt> object.
   */
  withOneSub: function(ims, userOrTopic) {
    return this.withSub(ims, undefined, userOrTopic);
  },

  /**
   * Add query parameters to fetch a single subscription if it's been updated since the last update.
   * @memberof Tinode.MetaGetBuilder#
   *
   * @param {String=} userOrTopic user ID or topic name to fetch for fetching one subscription.
   *
   * @returns {Tinode.MetaGetBuilder} <tt>this</tt> object.
   */
  withLaterOneSub: function(userOrTopic) {
    return this.withOneSub(this.topic._lastSubsUpdate, userOrTopic);
  },

  /**
   * Add query parameters to fetch subscriptions updated since the last update.
   * @memberof Tinode.MetaGetBuilder#
   *
   * @param {Number=} limit maximum number of subscriptions to fetch.
   *
   * @returns {Tinode.MetaGetBuilder} <tt>this</tt> object.
   */
  withLaterSub: function(limit) {
    return this.withSub(this.topic._lastSubsUpdate, limit);
  },

  /**
   * Add query parameters to fetch topic tags.
   * @memberof Tinode.MetaGetBuilder#
   *
   * @returns {Tinode.MetaGetBuilder} <tt>this</tt> object.
   */
  withTags: function() {
    this.what["tags"] = true;
    return this;
  },

  /**
   * Add query parameters to fetch deleted messages within explicit limits. Any/all parameters can be null.
   * @memberof Tinode.MetaGetBuilder#
   *
   * @param {Number=} since ids of messages deleted since this 'del' id (inclusive)
   * @param {Number=} limit number of deleted message ids to fetch
   *
   * @returns {Tinode.MetaGetBuilder} <tt>this</tt> object.
   */
  withDel: function(since, limit) {
    if (since || limit) {
      this.what["del"] = {since: since, limit: limit};
    }
    return this;
  },

  /**
   * Add query parameters to fetch messages deleted after the saved 'del' id.
   * @memberof Tinode.MetaGetBuilder#
   *
   * @param {Number=} limit number of deleted message ids to fetch
   *
   * @returns {Tinode.MetaGetBuilder} <tt>this</tt> object.
   */
  withLaterDel: function(limit) {
    // Specify 'since' only if we have already received some messages. If
    // we have no locally cached messages then we don't care if any messages were deleted.
    return this.withDel(this.topic._maxSeq > 0 ? this.topic._maxDel + 1 : undefined, limit);
  },

  /**
   * Construct parameters
   * @memberof Tinode.MetaGetBuilder#
   *
   * @returns {Tinode.GetQuery} Get query
   */
  build: function() {
    var params = {};
    var what = [];
    var instance = this;
    ["data", "sub", "desc", "tags", "del"].map(function(key) {
      if (instance.what.hasOwnProperty(key)) {
        what.push(key);
        if (Object.getOwnPropertyNames(instance.what[key]).length > 0) {
          params[key] = instance.what[key];
        }
      }
    });
    if (what.length > 0) {
      params.what = what.join(" ");
    } else {
      params = undefined;
    }
    return params;
  }
};

/**
 * Helper class for handling access mode.
 *
 * @class AccessMode
 * @memberof Tinode
 *
 * @param {AccessMode|Object=} acs AccessMode to copy or access mode object received from the server.
 */
var AccessMode = function(acs) {
  if (acs) {
    this.given = typeof acs.given == 'number' ? acs.given : AccessMode.decode(acs.given);
    this.want = typeof acs.want == 'number' ? acs.want : AccessMode.decode(acs.want);
    this.mode = acs.mode ? (typeof acs.mode == 'number' ? acs.mode : AccessMode.decode(acs.mode)) :
      (this.given & this.want);
  }
};

AccessMode._NONE    = 0x00;
AccessMode._JOIN    = 0x01;
AccessMode._READ    = 0x02;
AccessMode._WRITE   = 0x04;
AccessMode._PRES    = 0x08;
AccessMode._APPROVE = 0x10;
AccessMode._SHARE   = 0x20;
AccessMode._DELETE  = 0x40;
AccessMode._OWNER   = 0x80;

AccessMode._BITMASK = AccessMode._JOIN | AccessMode._READ | AccessMode._WRITE | AccessMode._PRES |
  AccessMode._APPROVE | AccessMode._SHARE | AccessMode._DELETE | AccessMode._OWNER;
AccessMode._INVALID  = 0x100000;

/**
* Parse string into an access mode value.
* @memberof Tinode.AccessMode
* @static
*
* @param {string} mode - String representation of the access mode to parse.
* @returns {number} - Access mode as a numeric value.
*/
AccessMode.decode = function(str) {
  if (!str) {
    return null;
  } else if (typeof str == 'number') {
    return str & AccessMode._BITMASK;
  } else if (str === 'N' || str === 'n') {
    return AccessMode._NONE;
  }

  var bitmask = {
    'J': AccessMode._JOIN,
    'R': AccessMode._READ,
    'W': AccessMode._WRITE,
    'P': AccessMode._PRES,
    'A': AccessMode._APPROVE,
    'S': AccessMode._SHARE,
    'D': AccessMode._DELETE,
    'O': AccessMode._OWNER
  };

  var m0 = AccessMode._NONE;

  for (var i=0; i<str.length; i++) {
    var c = str.charAt(i).toUpperCase();
    var bit = bitmask[c];
    if (!bit) {
      // Unrecognized bit, skip.
      continue;
    }
    m0 |= bit;
  }
  return m0;
};

/**
* Convert numeric representation of the access mode into a string.
*
* @memberof Tinode.AccessMode
* @static
*
* @param {number} val - access mode value to convert to a string.
* @returns {string} - Access mode as a string.
*/
AccessMode.encode = function(val) {
  if (val === null || val === AccessMode._INVALID) {
    return null;
  } else if (val === AccessMode._NONE) {
    return 'N';
  }

  var bitmask = ['J','R','W','P','A','S','D','O'];
  var res = "";
  for (var i=0; i<bitmask.length; i++) {
    if ((val & (1 << i)) != 0) {
      res = res + bitmask[i];
    }
  }
  return res;
};

/**
* Update numeric representation of access mode with the new value. The value
* is one of the following:
*  - a string starting with '+' or '-' then the bits to add or remove, e.g. '+R-W' or '-PS'.
*  - a new value of access mode
*
* @memberof Tinode.AccessMode
* @static
*
* @param {number} val - access mode value to update.
* @param {string} upd - update to apply to val.
* @returns {number} - updated access mode.
*/
AccessMode.update = function(val, upd) {
  if (!upd || typeof upd != 'string') {
    return val;
  }

  var action = upd.charAt(0);
  if (action == '+' || action == '-') {
    var val0 = val;
    // Split delta-string like '+ABC-DEF+Z' into an array of parts including + and -.
    var parts = upd.split(/([-+])/);
    // Starting iteration from 1 because String.split() creates an array with the first empty element.
    // Iterating by 2 because we parse pairs +/- then data.
    for (var i = 1; i < parts.length-1; i += 2) {
      action = parts[i];
      var m0 = AccessMode.decode(parts[i+1]);
      if (m0 == AccessMode._INVALID) {
        return val;
      }
      if (m0 == null) {
        continue;
      }
      if (action === '+') {
        val0 |= m0;
      } else if (action === '-') {
        val0 &= ~m0;
      }
    }
    val = val0;
  } else {
    // The string is an explicit new value 'ABC' rather than delta.
    var val0 = AccessMode.decode(upd);
    if (val0 != AccessMode._INVALID) {
      val = val0;
    }
  }

  return val;
};

/**
 * AccessMode is a class representing topic access mode.
 * @class Topic
 * @memberof Tinode
 */
AccessMode.prototype = {
  setMode: function(m) { this.mode = AccessMode.decode(m); return this; },
  updateMode: function(u) { this.mode = AccessMode.update(this.mode, u); return this; },
  getMode: function() { return AccessMode.encode(this.mode); },

  setGiven: function(g) { this.given = AccessMode.decode(g); return this; },
  updateGiven: function(u) { this.given = AccessMode.update(this.given, u); return this; },
  getGiven: function() { return AccessMode.encode(this.given);},

  setWant: function(w) { this.want = AccessMode.decode(w); return this; },
  updateWant: function(u) { this.want = AccessMode.update(this.want, u); return this; },
  getWant: function() { return AccessMode.encode(this.want); },

  updateAll: function(val) {
    if (val) {
      this.updateGiven(val.given);
      this.updateWant(val.want);
      this.mode = this.given & this.want;
    }
    return this;
  },

  isOwner:    function() { return ((this.mode & AccessMode._OWNER) != 0); },
  isMuted:    function() { return ((this.mode & AccessMode._PRES) == 0); },
  isPresencer:function() { return ((this.mode & AccessMode._PRES) != 0); },
  isJoiner:   function() { return ((this.mode & AccessMode._JOIN) != 0); },
  isReader:   function() { return ((this.mode & AccessMode._READ) != 0); },
  isWriter:   function() { return ((this.mode & AccessMode._WRITE) != 0); },
  isApprover: function() { return ((this.mode & AccessMode._APPROVE) != 0); },
  isAdmin:    function() { return this.isOwner() || this.isApprover() },
  isSharer:   function() { return ((this.mode & AccessMode._SHARE) != 0); },
  isDeleter:  function() { return ((this.mode & AccessMode._DELETE) != 0); }
};

/**
 * @callback Tinode.Topic.onData
 * @param {Data} data - Data packet
 */
/**
 * Topic is a class representing a logical communication channel.
 * @class Topic
 * @memberof Tinode
 *
 * @param {string} name - Name of the topic to create.
 * @param {Object=} callbacks - Object with various event callbacks.
 * @param {Tinode.Topic.onData} callbacks.onData - Callback which receives a {data} message.
 * @param {callback} callbacks.onMeta - Callback which receives a {meta} message.
 * @param {callback} callbacks.onPres - Callback which receives a {pres} message.
 * @param {callback} callbacks.onInfo - Callback which receives an {info} message.
 * @param {callback} callbacks.onMetaDesc - Callback which receives changes to topic desctioption {@link desc}.
 * @param {callback} callbacks.onMetaSub - Called for a single subscription record change.
 * @param {callback} callbacks.onSubsUpdated - Called after a batch of subscription changes have been recieved and cached.
 * @param {callback} callbacks.onDeleteTopic - Called when the topic is being deleted.
 */
var Topic = function(name, callbacks) {
  // Server-provided data, locally immutable.
  // topic name
  this.name = name;
  // timestamp when the topic was created
  this.created = null;
  // timestamp when the topic was last updated
  this.updated = null;
  // timestamp of the last messages
  this.touched = null;
  // access mode, see AccessMode
  this.acs = new AccessMode(null);
  // per-topic private data
  this.private = null;
  // per-topic public data
  this.public = null;

  // Locally cached data
  // Subscribed users, for tracking read/recv/msg notifications.
  this._users = {};

  // Current value of locally issued seqId, used for pending messages.
  this._queuedSeqId = LOCAL_SEQID;

  // The maximum known {data.seq} value.
  this._maxSeq = 0;
  // The minimum known {data.seq} value.
  this._minSeq = 0;
  // Indicator that the last request for earlier messages returned 0.
  this._noEarlierMsgs = false;
  // The maximum known deletion ID.
  this._maxDel = 0;
  // User discovery tags
  this._tags = [];
  // Message cache, sorted by message seq values, from old to new.
  this._messages = CBuffer(function(a,b) { return a.seq - b.seq; });
  // Boolean, true if the topic is currently live
  this._subscribed = false;
  // Timestap when topic meta-desc update was recived.
  this._lastDescUpdate = null;
  // Timestap when topic meta-subs update was recived.
  this._lastSubsUpdate = null;
  // Used only during initialization
  this._new = true;

  // Callbacks
  if (callbacks) {
    this.onData = callbacks.onData;
    this.onMeta = callbacks.onMeta;
    this.onPres = callbacks.onPres;
    this.onInfo = callbacks.onInfo;
    // A single desc update;
    this.onMetaDesc = callbacks.onMetaDesc;
    // A single subscription record;
    this.onMetaSub = callbacks.onMetaSub;
    // All subscription records received;
    this.onSubsUpdated = callbacks.onSubsUpdated;
    this.onTagsUpdated = callbacks.onTagsUpdated;
    this.onDeleteTopic = callbacks.onDeleteTopic;
  }
};

Topic.prototype = {

  /**
   * Check if the topic is subscribed.
   * @memberof Tinode.Topic#
   * @returns {boolean} True is topic is attached/subscribed, false otherwise.
   */
  isSubscribed: function() {
    return this._subscribed;
  },

  /**
   * Request topic to subscribe. Wrapper for {@link Tinode#subscribe}.
   * @memberof Tinode.Topic#
   *
   * @param {Tinode.GetQuery=} getParams - get query parameters.
   * @param {Tinode.SetParams=} setParams - set parameters.
   * @returns {Promise} Promise to be resolved/rejected when the server responds to the request.
   */
  subscribe: function(getParams, setParams) {
    // If the topic is already subscribed, return resolved promise
    if (this._subscribed) {
      return Promise.resolve(this);
    }

    var name = this.name;
    var tinode = Tinode.getInstance();
    // Closure for the promise below.
    var topic = this;
    // Send subscribe message, handle async response.
    // If topic name is explicitly provided, use it. If no name, then it's a new group topic,
    // use "new".
    return tinode.subscribe(name || TOPIC_NEW, getParams, setParams).then(function(ctrl) {
      if (ctrl.code >= 300) {
        // If the topic already exists, do nothing.
        return ctrl;
      }

      topic._subscribed = true;
      topic.acs = (ctrl.params && ctrl.params.acs) ? ctrl.params.acs : topic.acs;

      // Set topic name for new topics and add it to cache.
      if (topic._new) {
        topic._new = false;

        topic.name = ctrl.topic;
        topic.created = ctrl.ts;
        topic.updated = ctrl.ts;
        topic.touched = ctrl.ts;

        topic._cachePutSelf();

        // Add the new topic to the list of contacts maintained by the 'me' topic.
        var me = tinode.getMeTopic();
        if (me) {
          me._processMetaSub([{
            _generated: true,
            topic: topic.name,
            created: ctrl.ts,
            updated: ctrl.ts,
            touched: ctrl.ts,
            acs: topic.acs
          }]);
        }

        if (setParams && setParams.desc) {
          setParams.desc._generated = true;
          topic._processMetaDesc(setParams.desc);
        }
      }

      return ctrl;
    });
  },

  /**
   * Publish data to topic. Wrapper for {@link Tinode#publish}.
   * @memberof Tinode.Topic#
   *
   * @param {Object} data - Data to publish.
   * @param {Boolean=} noEcho - If <tt>true</tt> server will not echo message back to originating session.
   * @param {String=} mimeType - Mime-type of the data. Default is 'text/plain'.
   * @param {Array=} attachments - URLs of files attached to the message.
   * @returns {Promise} Promise to be resolved/rejected when the server responds to the request.
   */
  publish: function(data) {
    // Send data
    return this.publishMessage(this.createMessage(data));
  },

  /**
   * Create a draft of a message without sending it to the server.
   * @memberof Tinode.Topic#
   *
   * @param {Object} data - Content to wrap in a a draft.
   * @param {Boolean=} noEcho - If <tt>true</tt> server will not echo message back to originating
   * session. Otherwise the server will send a copy of the message to sender.
   *
   * @returns {Object} message draft.
   */
  createMessage: function(data, noEcho) {
    var mimeType, attachments;
    if (!Drafty.isPlainText(data)) {
      mimeType = Drafty.getContentType();
      if (Drafty.hasAttachments(data)) {
        attachments = [];
        Drafty.attachments(data, (val) => { attachments.push(val); });
      }
    }
    return Tinode.getInstance().createMessage(this.name, data, noEcho, mimeType, attachments);
  },

   /**
    * Publish message created by {@link Tinode.Topic#createMessage}.
    * @memberof Tinode.Topic#
    *
    * @param {Object} pkt - Data to publish.
    *
    * @returns {Promise} Promise to be resolved/rejected when the server responds to the request.
    */
   publishMessage: function(pub) {
     if (!this._subscribed) {
       return Promise.reject(new Error("Cannot publish on inactive topic"));
     }

     // Send data
     pub._sending = true;
     return Tinode.getInstance().publishMessage(pub);
   },

 /**
  * Add message to local message cache but do not send to the server.
  * The message should be created by {@link Tinode.Topic#createMessage}.
  * This is probably not the final API.
  * @memberof Tinode.Topic#
  *
  * @param {Object} pkt - Message to use as a draft.
  * @param {Promise} prom - Message will be sent when this promise is resolved, discarded if rejected.
  *
  * @returns {Promise} derived promise.
  */
  publishDraft: function(pub, prom) {
    if (!prom && !this._subscribed) {
      return Promise.reject(new Error("Cannot publish on inactive topic"));
    }

    // The 'seq', 'ts', and 'from' are added to mimic {data}. They are removed later
    // before the message is sent.
    var seq = pub.seq = this._getQueuedSeqId();
    pub._generated = true;
    pub.ts = new Date();
    pub.from = Tinode.getInstance().getCurrentUserID();

    // Don't need an echo message becasue the message is added to local cache right away.
    pub.noecho = true;
    // Add to cache.
    this._messages.put(pub);

    if (this.onData) {
      this.onData(pub);
    }

    // If promise is provided, send the queued message when it's resolved.
    // If no promise is provided, create a resolved one and send immediately.
    prom = (prom || Promise.resolve()).then(
      (/* argument ignored */) => {
        if (pub._cancelled) {
          return {code: 300, text: "cancelled"};
        }
        return this.publishMessage(pub).then((ctrl) => {
          pub._sending = false;
          pub.seq = ctrl.params.seq;
          pub.ts = ctrl.ts;
          this._routeData(pub);
          return ctrl;
        });
      },
      (err) => {
        pub._sending = false;
        this._messages.delAt(this._messages.find(pub));
        if (this.onData) {
          this.onData();
        }
      });
    return prom;
  },

  /**
   * Leave the topic, optionally unsibscribe. Leaving the topic means the topic will stop
   * receiving updates from the server. Unsubscribing will terminate user's relationship with the topic.
   * Wrapper for {@link Tinode#leave}.
   * @memberof Tinode.Topic#
   *
   * @param {Boolean=} unsub - If true, unsubscribe, otherwise just leave.
   * @returns {Promise} Promise to be resolved/rejected when the server responds to the request.
   */
  leave: function(unsub) {
    // It's possible to unsubscribe (unsub==true) from inactive topic.
    if (!this._subscribed && !unsub) {
      return Promise.reject(new Error("Cannot leave inactive topic"));
    }

    // Send a 'leave' message, handle async response
    return Tinode.getInstance().leave(this.name, unsub).then((ctrl) => {
      this._resetSub();
      if (unsub) {
        this._gone();
      }
      return ctrl;
    });
  },

  /**
   * Request topic metadata from the server.
   * @memberof Tinode.Topic#
   *
   * @param {Tinode.GetQuery} request parameters
   *
   * @returns {Promise} Promise to be resolved/rejected when the server responds to request.
   */
  getMeta: function(params) {
    if (!this._subscribed) {
      console.log("Attempt to query inactive topic", this.name);
      return Promise.reject(new Error("Cannot query inactive topic"));
    }
    // Send {get} message, return promise.
    return Tinode.getInstance().getMeta(this.name, params);
  },

  /**
   * Request more messages from the server
   * @memberof Tinode.Topic#
   *
   * @param {integer} limit number of messages to get.
   * @param {boolean} forward if true, request newer messages.
   */
  getMessagesPage: function(limit, forward) {
    var query = this.startMetaQuery();
    if (forward) {
      query.withLaterData(limit);
    } else {
      query.withEarlierData(limit);
    }
    var promise = this.getMeta(query.build());
    if (!forward) {
      var instance = this;
      promise = promise.then(function(ctrl) {
        if (ctrl && ctrl.params && !ctrl.params.count) {
          instance._noEarlierMsgs = true;
        }
      });
    }
    return promise;
  },

  /**
   * Update topic metadata.
   * @memberof Tinode.Topic#
   *
   * @param {Tinode.SetParams} params parameters to update.
   * @returns {Promise} Promise to be resolved/rejected when the server responds to request.
   */
  setMeta: function(params) {
    if (!this._subscribed) {
      return Promise.reject(new Error("Cannot update inactive topic"));
    }

    var topic = this;
    if (params.tags) {
      params.tags = normalizeArray(params.tags);
    }
    var tinode = Tinode.getInstance();
    // Send Set message, handle async response.
    return tinode.setMeta(this.name, params)
      .then(function(ctrl) {
        if (ctrl && ctrl.code >= 300) {
          // Not modified
          return ctrl;
        }

        if (params.sub) {
          if (ctrl.params && ctrl.params.acs) {
            params.sub.acs = ctrl.params.acs;
            params.sub.updated = ctrl.ts;
          }
          if (!params.sub.user) {
            // This is a subscription update of the current user.
            // Assign user ID otherwise the update will be ignored by _processMetaSub.
            params.sub.user = tinode.getCurrentUserID();
            if (!params.desc) {
              // Force update to topic's asc.
              params.desc = {};
            }
          }
          params.sub._generated = true;
          topic._processMetaSub([params.sub]);
        }

        if (params.desc) {
          if (ctrl.params && ctrl.params.acs) {
            params.desc.acs = ctrl.params.acs;
            params.desc.updated = ctrl.ts;
          }
          topic._processMetaDesc(params.desc);
        }

        if (params.tags) {
          topic._processMetaTags(params.tags);
        }

        return ctrl;
      });
  },

  /**
   * Create new topic subscription.
   * @memberof Tinode.Topic#
   *
   * @param {String} uid - ID of the user to invite
   * @param {String=} mode - Access mode. <tt>null</tt> means to use default.
   *
   * @returns {Promise} Promise to be resolved/rejected when the server responds to request.
   */
  invite: function(uid, mode) {
    return this.setMeta({sub: {user: uid, mode: mode}});
  },

  /**
   * Delete messages. Hard-deleting messages requires Owner permission.
   * Wrapper for {@link Tinode#delMessages}.
   * @memberof Tinode.Topic#
   *
   * @param {Tinode.DelRange[]} ranges - Ranges of message IDs to delete.
   * @param {Boolean=} hard - Hard or soft delete
   * @returns {Promise} Promise to be resolved/rejected when the server responds to request.
   */
  delMessages: function(ranges, hard) {
    if (!this._subscribed) {
      return Promise.reject(new Error("Cannot delete messages in inactive topic"));
    }

    // Sort ranges in accending order by low, the descending by hi.
    ranges.sort(function(r1, r2) {
      if (r1.low < r2.low) {
    		return true;
    	}
      if (r1.low == r2.low) {
    		return !r2.hi || (r1.hi >= r2.hi);
    	}
    	return false;
    });

    // Remove pending messages from ranges possibly clipping some ranges.
    let tosend = ranges.reduce((out, r) => {
      if (r.low < LOCAL_SEQID) {
        if (!r.hi || r.hi < LOCAL_SEQID) {
          out.push(r);
        } else {
          // Clip hi to max allowed value.
          out.push({low: r.low, hi: this._maxSeq+1});
        }
      }
      return out;
    }, []);

    // Send {del} message, return promise
    let result;
    if (ranges.length > 0) {
      result = Tinode.getInstance().delMessages(this.name, tosend, hard);
    } else {
      result = Promise.resolve({params: {del: 0}});
    }
    // Update local cache.
    return result.then((ctrl) => {
      if (ctrl.params.del > this._maxDel) {
        this._maxDel = ctrl.params.del;
      }

      ranges.map((r) => {
        if (r.hi) {
          this.flushMessageRange(r.low, r.hi);
        } else {
          this.flushMessage(r.low);
        }
      });

      if (this.onData) {
        // Calling with no parameters to indicate the messages were deleted.
        this.onData();
      }
      return ctrl;
    });
  },

  /**
   * Delete all messages. Hard-deleting messages requires Owner permission.
   * @memberof Tinode.Topic#
   *
   * @param {boolean} hardDel - true if messages should be hard-deleted.
   *
   * @returns {Promise} Promise to be resolved/rejected when the server responds to request.
   */
  delMessagesAll: function(hardDel) {
    return this.delMessages([{low: 1, hi: this._maxSeq+1, _all: true}], hardDel);
  },

  /**
   * Delete multiple messages defined by their IDs. Hard-deleting messages requires Owner permission.
   * @memberof Tinode.Topic#
   *
   * @param {Tinode.DelRange[]} list - list of seq IDs to delete
   * @param {Boolean=} hardDel - true if messages should be hard-deleted.
   *
   * @returns {Promise} Promise to be resolved/rejected when the server responds to request.
   */
  delMessagesList: function(list, hardDel) {
    // Sort the list in ascending order
    list.sort((a, b) => a - b);
    // Convert the array of IDs to ranges.
    var ranges = list.reduce((out, id) => {
      if (out.length == 0) {
        // First element.
        out.push({low: id});
      } else {
        let prev = out[out.length-1];
        if ((!prev.hi && (id != prev.low + 1)) || (id > prev.hi)) {
          // New range.
          out.push({low: id});
        } else {
          // Expand existing range.
          prev.hi = prev.hi ? Math.max(prev.hi, id + 1) : id + 1;
        }
      }
      return out;
    }, []);
    // Send {del} message, return promise
    return this.delMessages(ranges, hardDel)
  },

  /**
   * Delete topic. Requires Owner permission. Wrapper for {@link Tinode#delTopic}.
   * @memberof Tinode.Topic#
   *
   * @returns {Promise} Promise to be resolved/rejected when the server responds to the request.
   */
  delTopic: function() {
    var topic = this;
    return Tinode.getInstance().delTopic(this.name).then(function(ctrl) {
      topic._resetSub();
      topic._gone();
      return ctrl;
    });
  },

  /**
   * Delete subscription. Requires Share permission. Wrapper for {@link Tinode#delSubscription}.
   * @memberof Tinode.Topic#
   *
   * @param {String} user - ID of the user to remove subscription for.
   * @returns {Promise} Promise to be resolved/rejected when the server responds to request.
   */
  delSubscription: function(user) {
    if (!this._subscribed) {
      return Promise.reject(new Error("Cannot delete subscription in inactive topic"));
    }
    var topic = this;
    // Send {del} message, return promise
    return Tinode.getInstance().delSubscription(this.name, user).then(function(ctrl) {
      // Remove the object from the subscription cache;
      delete topic._users[user];
      // Notify listeners
      if (topic.onSubsUpdated) {
        topic.onSubsUpdated(Object.keys(topic._users));
      }
      return ctrl;
    });
  },

  /**
   * Send a read/recv notification
   * @memberof Tinode.Topic#
   *
   * @param {String} what - what notification to send: <tt>recv</tt>, <tt>read</tt>.
   * @param {Number} seq - ID or the message read or received.
   */
  note: function(what, seq) {
    var tinode = Tinode.getInstance();
    var user = this._users[tinode.getCurrentUserID()];
    if (user) {

      if (!user[what] || user[what] < seq) {
        if (this._subscribed) {
          tinode.note(this.name, what, seq);
        } else {
          console.log("Not sending {note} on inactive topic");
        }
      }
      user[what] = seq;
    } else {
      console.log("note(): user not found " + tinode.getCurrentUserID());
    }

    // Update locally cached contact with the new count
    var me = tinode.getMeTopic();
    if (me) {
      me.setMsgReadRecv(this.name, what, seq);
    }
  },

  /**
   * Send a 'recv' receipt. Wrapper for {@link Tinode#noteRecv}.
   * @memberof Tinode.Topic#
   *
   * @param {Number} seq - ID of the message to aknowledge.
   */
  noteRecv: function(seq) {
    this.note("recv", seq);
  },

  /**
   * Send a 'read' receipt. Wrapper for {@link Tinode#noteRead}.
   * @memberof Tinode.Topic#
   *
   * @param {Number} seq - ID of the message to aknowledge.
   */
  noteRead: function(seq) {
    this.note("read", seq);
  },

  /**
   * Send a key-press notification. Wrapper for {@link Tinode#noteKeyPress}.
   * @memberof Tinode.Topic#
   */
  noteKeyPress: function() {
    if (this._subscribed) {
      Tinode.getInstance().noteKeyPress(this.name);
    } else {
      console.log("Cannot send notification in inactive topic");
    }
  },

  /**
   * Get user description from cache.
   * @memberof Tinode.Topic#
   *
   * @param {String} uid - ID of the user to fetch.
   */
  userDesc: function(uid) {
    // TODO(gene): handle asynchronous requests

    var user = this._cacheGetUser(uid);
    if (user) {
      return user; // Promise.resolve(user)
    }
    //return Tinode.getInstance().get(uid);
  },

  /**
   * Iterate over cached subscribers. If callback is undefined, use this.onMetaSub.
   * @memberof Tinode.Topic#
   *
   * @param {Function} callback - Callback which will receive subscribers one by one.
   * @param {Object=} context - Value of `this` inside the `callback`.
   */
  subscribers: function(callback, context) {
    var cb = (callback || this.onMetaSub);
    if (cb) {
      for (var idx in this._users) {
        cb.call(context, this._users[idx], idx, this._users);
      }
    }
  },

  /**
   * Get a copy of cached tags.
   * @memberof Tinode.Topic#
   */
  tags: function() {
    // Return a copy.
    return this._tags.slice(0);
  },

  /**
   * Get cached subscription for the given user ID.
   * @memberof Tinode.Topic#
   *
   * @param {String} uid - id of the user to query for
   */
  subscriber: function(uid) {
    return this._users[uid];
  },

  /**
   * Iterate over cached messages. If callback is undefined, use this.onData.
   * @memberof Tinode.Topic#
   *
   * @param {function} callback - Callback which will receive messages one by one. See {@link Tinode.CBuffer#forEach}
   * @param {integer} sinceId - Optional seqId to start iterating from (inclusive).
   * @param {integer} beforeId - Optional seqId to stop iterating before (exclusive).
   * @param {Object} context - Value of `this` inside the `callback`.
   */
  messages: function(callback, sinceId, beforeId, context) {
    var cb = (callback || this.onData);
    if (cb) {
      let startIdx = typeof sinceId == 'number' ? this._messages.find({seq: sinceId}) : undefined;
      let beforeIdx = typeof beforeId == 'number' ? this._messages.find({seq: beforeId}, true) : undefined;
      if (startIdx != -1 && beforeIdx != -1) {
        this._messages.forEach(cb, startIdx, beforeIdx, context);
      }
    }
  },

  /**
   * Get the number of topic subscribers who marked this message as either recv or read
   * Current user is excluded from the count.
   * @memberof Tinode.Topic#
   *
   * @param {String} what - what notification to send: <tt>recv</tt>, <tt>read</tt>.
   * @param {Number} seq - ID or the message read or received.
   */
  msgReceiptCount: function(what, seq) {
    var count = 0;
    var me = Tinode.getInstance().getCurrentUserID();
    if (seq > 0) {
      for (var idx in this._users) {
        var user = this._users[idx];
        if (user.user !== me && user[what] >= seq) {
          count++;
        }
      }
    }
    return count;
  },

  /**
   * Get the number of topic subscribers who marked this message (and all older messages) as read.
   * The current user is excluded from the count.
   * @memberof Tinode.Topic#
   *
   * @param {Number} seq - Message id to check.
   * @returns {Number} Number of subscribers who claim to have received the message.
   */
  msgReadCount: function(seq) {
    return this.msgReceiptCount("read", seq);
  },

  /**
   * Get the number of topic subscribers who marked this message (and all older messages) as received.
   * The current user is excluded from the count.
   * @memberof Tinode.Topic#
   *
   * @param {number} seq - Message id to check.
   * @returns {number} Number of subscribers who claim to have received the message.
   */
  msgRecvCount: function(seq) {
    return this.msgReceiptCount("recv", seq);
  },

  /**
   * Check if cached message IDs indicate that the server may have more messages.
   * @memberof Tinode.Topic#
   *
   * @param {boolean} newer check for newer messages
   */
  msgHasMoreMessages: function(newer) {
    return newer ? this.seq > this._maxSeq :
    // _minSeq cound be more than 1, but earlier messages could have been deleted.
      (this._minSeq > 1 && !this._noEarlierMsgs);
  },

  /**
   * Check if the given seq Id is id of the most recent message.
   * @memberof Tinode.Topic#
   *
   * @param {integer} seqId id of the message to check
   */
  isNewMessage: function(seqId) {
    return this._maxSeq <= seqId;
  },

  /**
   * Remove one message from local cache.
   * @memberof Tinode.Topic#
   *
   * @param {integer} seqId id of the message to remove from cache.
   * @returns {Message} removed message or undefined if such message was not found.
   */
  flushMessage: function(seqId) {
    let idx = this._messages.find({seq: seqId});
    return idx >=0 ? this._messages.delAt(idx) : undefined;
  },

  /**
   * Remove a range of messages from the local cache.
   * @memberof Tinode.Topic#
   *
   * @param {integer} fromId seq ID of the first message to remove (inclusive).
   * @param {integer} untilId seqID of the last message to remove (exclusive).
   *
   * @returns {Message[]} array of removed messages (could be empty).
   */
  flushMessageRange: function(fromId, untilId) {
    // start: find exact match.
    // end: find insertion point (nearest == true).
    let since = this._messages.find({seq: fromId});
    return since >= 0 ? this._messages.delRange(since, this._messages.find({seq: untilId}, true)) : [];
  },

  /**
   * Attempt to stop message from being sent.
   * @memberof Tinode.Topic#
   *
   * @param {integer} seqId id of the message to stop sending and remove from cache.
   *
   * @returns {boolean} true if message was cancelled, false otherwise.
   */
  cancelSend: function(seqId) {
    let idx = this._messages.find({seq: seqId});
    if (idx >=0) {
      let msg = this._messages.getAt(idx);
      let status = this.msgStatus(msg);
      if (status == MESSAGE_STATUS_QUEUED) {
        msg._cancelled = true;
        this._messages.delAt(idx);
        return true;
      }
    }
    return false;
  },

  /**
   * Get type of the topic: me, p2p, grp, fnd...
   * @memberof Tinode.Topic#
   *
   * @returns {String} One of 'me', 'p2p', 'grp', 'fnd' or <tt>undefined</tt>.
   */
  getType: function() {
    return Tinode.getInstance().topicType(this.name);
  },

  /**
   * Get user's cumulative access mode of the topic.
   * @memberof Tinode.Topic#
   *
   * @returns {Tinode.AccessMode} - user's access mode
   */
  getAccessMode: function() {
    return this.acs;
  },

  /**
   * Get topic's default access mode.
   * @memberof Tinode.Topic#
   *
   * @returns {Tinode.DefAcs} - access mode, such as {auth: `RWP`, anon: `N`}.
   */
  getDefaultAccess: function() {
      return this.defacs;
  },

  /**
   * Initialize new meta {@link Tinode.GetQuery} builder. The query is attched to the current topic.
   * It will not work correctly if used with a different topic.
   * @memberof Tinode.Topic#
   *
   * @returns {Tinode.MetaGetBuilder} query attached to the current topic.
   */
  startMetaQuery: function() {
    return new MetaGetBuilder(this);
  },

  /**
   * Get status (queued, sent, received etc) of a given message in the context
   * of this topic.
   * @memberof Tinode.Topic#
   *
   * @param {Message} msg message to check for status.
   * @returns message status constant.
   */
  msgStatus: function(msg) {
    var status = MESSAGE_STATUS_NONE;
    if (msg.from == Tinode.getInstance().getCurrentUserID()) {
      if (msg._sending) {
        status = MESSAGE_STATUS_SENDING;
      } else if (msg.seq >= LOCAL_SEQID) {
        status = MESSAGE_STATUS_QUEUED;
      } else if (this.msgReadCount(msg.seq) > 0) {
        status = MESSAGE_STATUS_READ;
      } else if (this.msgRecvCount(msg.seq) > 0) {
        status = MESSAGE_STATUS_RECEIVED;
      } else if (msg.seq > 0) {
        status = MESSAGE_STATUS_SENT;
      }
    } else {
      status = MESSAGE_STATUS_TO_ME;
    }
    return status;
  },

  // Process data message
  _routeData: function(data) {
    // Maybe this is an empty message to indicate there are no actual messages.
    if (data.content) {
      if (!this.touched || this.touched < data.ts) {
        this.touched = data.ts;
      }

      if (!data._generated) {
        this._messages.put(data);
      }
    }

    if (data.seq > this._maxSeq) {
      this._maxSeq = data.seq;
    }
    if (data.seq < this._minSeq || this._minSeq == 0) {
      this._minSeq = data.seq;
    }

    if (this.onData) {
      this.onData(data);
    }

    // Update locally cached contact with the new message count
    var me = Tinode.getInstance().getMeTopic();
    if (me) {
      me.setMsgReadRecv(this.name, "msg", data.seq, data.ts);
    }
  },

  // Process metadata message
  _routeMeta: function(meta) {
    if (meta.desc) {
      this._lastDescUpdate = meta.ts;
      this._processMetaDesc(meta.desc);
    }
    if (meta.sub && meta.sub.length > 0) {
      this._lastSubsUpdate = meta.ts;
      this._processMetaSub(meta.sub);
    }
    if (meta.del) {
      this._processDelMessages(meta.del.clear, meta.del.delseq);
    }
    if (meta.tags) {
      this._processMetaTags(meta.tags);
    }
    if (this.onMeta) {
      this.onMeta(meta);
    }
  },

  // Process presence change message
  _routePres: function(pres) {
    var user;
    switch (pres.what) {
      case "del":
        // Delete cached messages.
        this._processDelMessages(pres.clear, pres.delseq);
        break;
      case "on":
      case "off":
        // Update online status of a subscription.
        user = this._users[pres.src];
        if (user) {
          user.online = pres.what == "on";
        } else {
          console.log("Presence update for an unknown user", this.name, pres.src);
        }
        break;
      case "acs":
        let uid = pres.src == "me" ? Tinode.getInstance().getCurrentUserID() : pres.src;
        user = this._users[uid];
        if (!user) {
          // Update for an unknown user
          var acs = new AccessMode().updateAll(pres.dacs);
          if (acs && acs.mode != AccessMode._NONE) {
            user = this._cacheGetUser(uid);
            if (!user) {
              user = {user: uid, acs: acs};
              this.getMeta(this.startMetaQuery().withOneSub(undefined, uid).build());
            } else {
              user.acs = acs;
            }
            user._generated = true;
            user.updated = new Date();
            this._processMetaSub([user]);
          }
        } else {
          // Known user
          user.acs.updateAll(pres.dacs);
          if (uid == Tinode.getInstance().getCurrentUserID()) {
            this.acs.updateAll(pres.dacs);
          }
          // User left topic.
          if (!user.acs || user.acs.mode == AccessMode._NONE) {
            if (this.getType() == 'p2p') {
              // If the second user unsubscribed from the topic, then the topic is no longer
              // useful.
              this.leave();
            }
            this._processMetaSub([{
              user: uid,
              deleted: new Date(),
              _generated: true}]);
          }
        }
        break;
      default:
        console.log("Ignored presence update", pres.what);
    }

    if (this.onPres) {
      this.onPres(pres);
    }
  },

  // Process {info} message
  _routeInfo: function(info) {
    if (info.what !== "kp") {
      var user = this._users[info.from];
      if (user) {
        user[info.what] = info.seq;
      }
    }
    if (this.onInfo) {
      this.onInfo(info);
    }
  },

  // Called by Tinode when meta.desc packet is received.
  // Called by 'me' topic on contact update (fromMe is true).
  _processMetaDesc: function(desc, fromMe) {
    // Copy parameters from desc object to this topic.
    mergeObj(this, desc);

    if (typeof this.created === "string") {
      this.created = new Date(this.created);
    }
    if (typeof this.updated === "string") {
      this.updated = new Date(this.updated);
    }
    if (typeof this.touched === "string") {
      this.touched = new Date(this.touched);
    }

    // Update relevant contact in the me topic, if available:
    if (this.name !== 'me' && !fromMe && !desc._generated) {
      var me = Tinode.getInstance().getMeTopic();
      if (me) {
        me._processMetaSub([{
          _generated: true,
          topic: this.name,
          updated: this.updated,
          touched: this.touched,
          acs: this.acs,
          public: this.public,
          private: this.private
        }]);
      }
    }

    if (this.onMetaDesc) {
        this.onMetaDesc(this);
    }
  },

  // Called by Tinode when meta.sub is recived or in response to received
  // {ctrl} after setMeta-sub.
  _processMetaSub: function(subs) {
    var updatedDesc = undefined;
    for (var idx in subs) {
      var sub = subs[idx];
      if (sub.user) { // Response to get.sub on 'me' topic does not have .user set
        // Save the object to global cache.
        sub.updated = new Date(sub.updated);
        sub.deleted = sub.deleted ? new Date(sub.deleted) : null;

        var user = null;
        if (!sub.deleted) {
          user = this._users[sub.user];
          if (!user) {
            user = this._cacheGetUser(sub.user);
          }
          user = this._updateCachedUser(sub.user, sub, sub._generated);
        } else {
          // Subscription is deleted, remove it from topic (but leave in Users cache)
          delete this._users[sub.user];
          user = sub;
        }

        if (this.onMetaSub) {
          this.onMetaSub(user);
        }
      } else if (!sub._generated) {
        updatedDesc = sub;
      }
    }

    if (updatedDesc && this.onMetaDesc) {
      this.onMetaDesc(updatedDesc);
    }

    if (this.onSubsUpdated) {
      this.onSubsUpdated(Object.keys(this._users));
    }
  },

  // Called by Tinode when meta.sub is recived.
  _processMetaTags: function(tags) {
    if (tags.length == 1 && tags[0] == DEL_CHAR) {
      tags = [];
    }
    this._tags = tags;
    if (this.onTagsUpdated) {
      this.onTagsUpdated(tags);
    }
  },

  // Delete cached messages and update cached transaction IDs
  _processDelMessages: function(clear, delseq) {
    this._maxDel = Math.max(clear, this._maxDel);
    this.clear = Math.max(clear, this.clear);
    var topic = this;
    var count = 0;
    if (Array.isArray(delseq)) {
      delseq.map(function(range) {
        if (!range.hi) {
          count++;
          topic.flushMessage(range.low);
        } else {
          for (var i = range.low; i < range.hi; i++) {
            count++;
            topic.flushMessage(i);
          }
        }
      });
    }
    if (count > 0 && this.onData) {
      this.onData();
    }
  },

  // Reset subscribed state
  _resetSub: function() {
    this._subscribed = false;
  },

  // This topic is either deleted or unsubscribed from.
  _gone: function() {
    var me = Tinode.getInstance().getMeTopic();
    if (me) {
      me._routePres({
        _generated: true,
        what: "gone",
        topic: "me",
        src: this.name
      });
    }
    if (this.onDeleteTopic) {
      this.onDeleteTopic();
    }
  },

  // Update global user cache and local subscribers cache.
  // Don't call this method for non-subscribers.
  _updateCachedUser: function(uid, obj, requestUpdate) {
    // Fetch user object from the global cache.
    // This is a clone of the stored object
    var cached = this._cacheGetUser(uid);
    if (cached) {
      cached = mergeObj(cached, obj);
    } else {
      // Cached object is not found. Issue a request for public/private.
      if (requestUpdate) {
        this.getMeta(this.startMetaQuery().withLaterOneSub(uid).build());
      }
      cached = mergeObj({}, obj);
    }
    // Save to global cache
    this._cachePutUser(uid, cached);
    // Save to the list of topic subsribers.
    return mergeToCache(this._users, uid, cached);
  },

  // Get local seqId for a queued message.
  _getQueuedSeqId: function() {
    return this._queuedSeqId++;
  }
};

/**
 * @class TopicMe - special case of {@link Tinode.Topic} for
 * managing data of the current user, including contact list.
 * @extends Tinode.Topic
 * @memberof Tinode
 *
 * @param {TopicMe.Callbacks} callbacks - Callbacks to receive various events.
 */
var TopicMe = function(callbacks) {
  Topic.call(this, TOPIC_ME, callbacks);
  // List of contacts (topic_name -> Contact object)
  this._contacts = {};

  // me-specific callbacks
  if (callbacks) {
    this.onContactUpdate = callbacks.onContactUpdate;
  }
};

// Inherit everyting from the generic Topic
TopicMe.prototype = Object.create(Topic.prototype, {
  // Override the original Topic._processMetaSub
  _processMetaSub: {
    value: function(subs) {
      var tinode = Tinode.getInstance();
      var updateCount  = 0;
      for (var idx in subs) {
        var sub = subs[idx];
        var topicName = sub.topic;
        // Don't show 'fnd' topic in the list of contacts
        if (topicName === TOPIC_FND) {
          continue;
        }
        sub.updated = new Date(sub.updated);
        sub.touched = sub.touched ? new Date(sub.touched) : null;
        sub.deleted = sub.deleted ? new Date(sub.deleted) : null;

        var cont = null;
        if (!sub.deleted) {
          if (sub.seen && sub.seen.when) {
            sub.seen.when = new Date(sub.seen.when);
          }
          cont = mergeToCache(this._contacts, topicName, sub);
          if (tinode.topicType(topicName) === 'p2p') {
            this._cachePutUser(topicName, cont);
          }

          // Notify topic of the update if it's a genuine event.
          if (!sub._generated) {
            var topic = tinode.getTopic(topicName);
            if (topic) {
              topic._processMetaDesc(sub, true);
            }
          }
        } else {
          cont = sub;
          delete this._contacts[topicName];
        }

        updateCount ++;

        if (this.onMetaSub) {
          this.onMetaSub(cont);
        }
      }

      if (updateCount > 0 && this.onSubsUpdated) {
        this.onSubsUpdated(Object.keys(this._contacts));
      }
    },
    enumerable: true,
    configurable: true,
    writable: false
  },

  // Process presence change message
  _routePres: {
    value: function(pres) {
      var cont = this._contacts[pres.src];
      if (cont) {
        switch (pres.what) {
          case "on": // topic came online
            cont.online = true;
            break;
          case "off": // topic went offline
            if (cont.online) {
              cont.online = false;
              if (cont.seen) {
                cont.seen.when = new Date();
              } else {
                cont.seen = {when: new Date()};
              }
            }
            break;
          case "msg": // new message received
            cont.touched = new Date();
            cont.seq = pres.seq;
            break;
          case "upd": // desc updated
            // Request updated description
            this.getMeta(this.startMetaQuery().withLaterOneSub(pres.src).build());
            break;
          case "acs": // access mode changed
            if (cont.acs) {
              cont.acs.updateAll(pres.dacs);
            } else {
              cont.acs = new AccessMode().updateAll(pres.dacs);
            }
            break;
          case "ua": // user agent changed
            cont.seen = {when: new Date(), ua: pres.ua};
            break;
          case "recv": // user's other session marked some messges as received
            cont.recv = cont.recv ? Math.max(cont.recv, pres.seq) : pres.seq;
            break;
          case "read": // user's other session marked some messages as read
            cont.read = cont.read ? Math.max(cont.read, pres.seq) : pres.seq;
            break;
          case "gone": // topic deleted or unsubscribed from
            delete this._contacts[pres.src];
            break;
          case "del":
            // Update topic.del value.
            break;
        }

        if (this.onContactUpdate) {
          this.onContactUpdate(pres.what, cont);
        }
      } else if (pres.what == "acs") {
        // New subscriptions and deleted/banned subscriptions have full
        // access mode (no + or - in the dacs string). Changes to known subscriptions are sent as
        // deltas, but they should not happen here.
        var acs = new AccessMode(pres.dacs);
        if (!acs || acs.mode == AccessMode._INVALID) {
          console.log("Invalid access mode update", pres.src, pres.dacs);
          return;
        } else if (acs.mode == AccessMode._NONE) {
          console.log("Removing non-existent subscription", pres.src, pres.dacs);
          return;
        } else {
          // New subscription. Send request for the full description.
          // Using .withOneSub (not .withLaterOneSub) to make sure IfModifiedSince is not set.
          this.getMeta(this.startMetaQuery().withOneSub(undefined, pres.src).build());
          // Create a dummy entry to catch online status update.
          this._contacts[pres.src] = {topic: pres.src, online: false, acs: acs};
        }
      }
      if (this.onPres) {
        this.onPres(pres);
      }
    },
    enumerable: true,
    configurable: true,
    writable: false
  },

  /**
   * Publishing to TopicMe is not supported. {@link Topic#publish} is overriden and thows an {Error} if called.
   * @memberof Tinode.TopicMe#
   * @throws {Error} Always throws an error.
   */
  publish: {
    value: function() {
      return Promise.reject(new Error("Publishing to 'me' is not supported"));
    },
    enumerable: true,
    configurable: true,
    writable: false
  },

  /**
   * Iterate over cached contacts. If callback is undefined, use {@link this.onMetaSub}.
   * @function
   * @memberof Tinode.TopicMe#
   * @param {TopicMe.ContactCallback=} callback - Callback to call for each contact.
   * @param {Object=} context - Context to use for calling the `callback`, i.e. the value of `this` inside the callback.
   */
  contacts: {
    value: function(callback, context) {
      var cb = (callback || this.onMetaSub);
      if (cb) {
        for (var idx in this._contacts) {
          cb.call(context, this._contacts[idx], idx, this._contacts);
        }
      }
    },
    enumerable: true,
    configurable: true,
    writable: true
  },

  /**
   * Update a cached contact with new read/received/message count.
   * @function
   * @memberof Tinode.TopicMe#
   *
   * @param {String} contactName - UID of contact to update.
   * @param {String} what - Whach count to update, one of <tt>"read", "recv", "msg"</tt>
   * @param {Number} seq - New value of the count.
   * @param {Date} ts - Timestamp of the update.
   */
  setMsgReadRecv: {
    value: function(contactName, what, seq, ts) {
      var cont = this._contacts[contactName];
      var oldVal, doUpdate = false;
      var mode = null;
      if (cont) {
        if (what === "recv") {
          oldVal = cont.recv;
          cont.recv = cont.recv ? Math.max(cont.recv, seq) : seq;
          doUpdate = (oldVal != cont.recv);
        } else if (what === "read") {
          oldVal = cont.read;
          cont.read = cont.read ? Math.max(cont.read, seq) : seq;
          doUpdate = (oldVal != cont.read);
          if (cont.recv < cont.read) {
            cont.recv = cont.read;
            doUpdate = true;
          }
        } else if (what === "msg") {
          oldVal = cont.seq;
          cont.seq = cont.seq ? Math.max(cont.seq, seq) : seq;
          if (!cont.touched || cont.touched < ts) {
            cont.touched = ts;
          }
          doUpdate = (oldVal != cont.seq);
        }

        if (doUpdate && (!cont.acs || !cont.acs.isMuted()) && this.onContactUpdate) {
          this.onContactUpdate(what, cont);
        }
      }
    },
    enumerable: true,
    configurable: true,
    writable: true
  },

  /**
   * Get a contact from cache.
   * @memberof Tinode.TopicMe#
   *
   * @param {string} name - Name of the contact to get, either a UID (for p2p topics) or a topic name.
   * @returns {Tinode.Contact} - Contact or `undefined`.
   */
  getContact: {
    value: function(name) {
      return this._contacts[name];
    },
    enumerable: true,
    configurable: true,
    writable: true
  },

  /**
   * Get the number of unread messages of a given contact.
   * @memberof Tinode.TopicMe#
   * @param {string} name - Name of the contact to get unread count for, either a UID (for p2p topics) or a topic name.
   *
   * @returns {number} - count of unread messages.
   */
  unreadCount: {
    value: function(name) {
      var c = this._contacts[name];
      if (c) {
        c.seq = ~~c.seq;
        c.read = ~~c.read;
        return c.seq - c.read;
      }
      return 0;
    },
    enumerable: true,
    configurable: true,
    writable: true
  },

  /**
   * Get access mode of a given contact from cache.
   * @memberof Tinode.TopicMe#
   *
   * @param {String} name - Name of the contact to get access mode for, aither a UID (for p2p topics) or a topic name.
   * @returns {string} - access mode, such as `RWP`.
   */
  getAccessMode: {
    value: function(name) {
      var cont = this._contacts[name];
      return cont ? cont.acs : null;
    },
    enumerable: true,
    configurable: true,
    writable: true
  }
});
TopicMe.prototype.constructor = TopicMe;

/**
 * @class TopicFnd - special case of {@link Tinode.Topic} for searching for
 * contacts and group topics.
 * @extends Tinode.Topic
 * @memberof Tinode
 *
 * @param {TopicFnd.Callbacks} callbacks - Callbacks to receive various events.
 */
var TopicFnd = function(callbacks) {
  Topic.call(this, TOPIC_FND, callbacks);
  // List of users and topics uid or topic_name -> Contact object)
  this._contacts = {};
};

// Inherit everyting from the generic Topic
TopicFnd.prototype = Object.create(Topic.prototype, {
  // Override the original Topic._processMetaSub
  _processMetaSub: {
    value: function(subs) {
      var tinode = Tinode.getInstance();
      var updateCount = Object.getOwnPropertyNames(this._contacts).length;
      // Reset contact list.
      this._contacts = {};
      for (var idx in subs) {
        var sub = subs[idx];
        var indexBy = sub.topic ? sub.topic : sub.user;

        sub.updated = new Date(sub.updated);
        if (sub.seen && sub.seen.when) {
          sub.seen.when = new Date(sub.seen.when);
        }

        sub = mergeToCache(this._contacts, indexBy, sub);
        updateCount ++;

        if (this.onMetaSub) {
          this.onMetaSub(sub);
        }
      }

      if (updateCount > 0 && this.onSubsUpdated) {
        this.onSubsUpdated(Object.keys(this._contacts));
      }
    },
    enumerable: true,
    configurable: true,
    writable: false
  },

  /**
   * Publishing to TopicFnd is not supported. {@link Topic#publish} is overriden and thows an {Error} if called.
   * @memberof Tinode.TopicFnd#
   * @throws {Error} Always throws an error.
   */
  publish: {
    value: function() {
      return Promise.reject(new Error("Publishing to 'fnd' is not supported"));
    },
    enumerable: true,
    configurable: true,
    writable: false
  },

  /**
   * setMeta to TopicFnd resets contact list in addition to sending the message.
   * @memberof Tinode.TopicFnd#
   */
  setMeta: {
    value: function(params) {
      var instance = this;
      return Object.getPrototypeOf(TopicFnd.prototype).setMeta.call(this, params).then(function() {
        if (Object.keys(instance._contacts).length > 0) {
          instance._contacts = {};
          if (instance.onSubsUpdated) {
            instance.onSubsUpdated([]);
          }
        }
      });
    },
    enumerable: true,
    configurable: true,
    writable: false
  },

  /**
   * Iterate over found contacts. If callback is undefined, use {@link this.onMetaSub}.
   * @function
   * @memberof Tinode.TopicMe#
   * @param {TopicFnd.ContactCallback} callback - Callback to call for each contact.
   * @param {Object} context - Context to use for calling the `callback`, i.e. the value of `this` inside the callback.
   */
  contacts: {
    value: function(callback, context) {
      var cb = (callback || this.onMetaSub);
      if (cb) {
        for (var idx in this._contacts) {
          cb.call(context, this._contacts[idx], idx, this._contacts);
        }
      }
    },
    enumerable: true,
    configurable: true,
    writable: true
  }
});
TopicFnd.prototype.constructor = TopicFnd;

/**
 * @class LargeFileHelper - collection of utilities for uploading and downloading files
 * out of band. Don't instantiate this class directly. Use {Tinode.getLargeFileHelper} instead.
 * @memberof Tinode
 *
 * @param {string} apikey_ - application's API key.
 * @param {string} authtoken_ - previously obtained authentication token.
 */
var LargeFileHelper = function(apikey_, authtoken_, msgId_) {
  this._apiKey = apikey_;
  this._authToken = authtoken_;
  this._msgId = msgId_;
  this.xhr = xdreq();

  // Promise
  this.toResolve = null;
  this.toReject = null;

  // Callbacks
  this.onProgress = null;
  this.onSuccess = null;
  this.onFailure = null;
}

LargeFileHelper.prototype = {

  /**
   * Start uploading the file.
   *
   * @memberof Tinode.LargeFileHelper#
   *
   * @param {File} file to upload
   * @param {Callback} onProgress callback. Takes one {float} parameter 0..1
   * @param {Callback} onSuccess callback. Called when the file is successfully uploaded.
   * @param {Callback} onFailure callback. Called in case of a failure.
   *
   * @returns {Promise} resolved/rejected when the upload is completed/failed.
   */
  upload: function(file, onProgress, onSuccess, onFailure) {
    var instance = this;
    this.xhr.open("POST", "/v" + PROTOCOL_VERSION + "/file/u/", true);
    this.xhr.setRequestHeader("X-Tinode-APIKey", this._apiKey);
    this.xhr.setRequestHeader("Authorization", "Token " + this._authToken);
    var result = new Promise((resolve, reject) => {
      this.toResolve = resolve;
      this.toReject = reject;
    });

    this.onProgress = onProgress;
    this.onSuccess = onSuccess;
    this.onFailure = onFailure;

    this.xhr.upload.onprogress = function(e) {
      if (e.lengthComputable && instance.onProgress) {
        instance.onProgress(e.loaded / e.total);
      }
    }

    this.xhr.onload = function() {
      var pkt;
      try {
        pkt = JSON.parse(this.response, jsonParseHelper);
      } catch(err) {
        console.log("Invalid server response in LargeFileHelper", this.response);
      }

      if (this.status >= 200 && this.status < 300) {
        if (instance.toResolve) {
          instance.toResolve(pkt.ctrl.params.url);
        }
        if (instance.onSuccess) {
          instance.onSuccess(pkt.ctrl);
        }
      } else if (this.status >= 400) {
        if (instance.toReject) {
          instance.toReject(new Error(pkt.ctrl.text + " (" + pkt.ctrl.code + ")"));
        }
        if (instance.onFailure) {
          instance.onFailure(pkt.ctrl)
        }
      } else {
        console.log("Unexpected server response status", this.status, this.response);
      }
    };

    this.xhr.onerror = function(e) {
      if (instance.toReject) {
        instance.toReject(new Error("failed"));
      }
      if (instance.onFailure) {
        instance.onFailure(null);
      }
    };

    this.xhr.onabort = function(e) {
      if (instance.toReject) {
        instance.toReject(new Error("upload cancelled by user"));
      }
      if (instance.onFailure) {
        instance.onFailure(null);
      }
    };

    try {
      var form = new FormData();
      form.append("file", file);
      form.set("id", this._msgId);
      this.xhr.send(form);
    } catch (err) {
      if (this.toReject) {
        this.toReject(err);
      }
      if (this.onFailure) {
        this.onFailure(null);
      }
    }

    return result;
  },

  /**
   * Download the file from a given URL using GET request. This method works with the Tinode server only.
   *
   * @memberof Tinode.LargeFileHelper#
   *
   * @param {String} relativeUrl - URL to download the file from. Must be relative url, i.e. must not contain the host.
   * @param {String=} filename - file name to use for the downloaded file.
   *
   * @returns {Promise} resolved/rejected when the download is completed/failed.
   */
  download: function(relativeUrl, filename, mimetype, onProgress) {
    if ((/^(?:(?:[a-z]+:)?\/\/)/i.test(relativeUrl))) {
      // As a security measure refuse to download from an absolute URL.
      console.log("The URL '" + relativeUrl + "' must be relative, not absolute");
      return;
    }
    var instance = this;
    // Get data as blob (stored by the browser as a temporary file).
    this.xhr.open("GET", relativeUrl, true);
    this.xhr.setRequestHeader("X-Tinode-APIKey", this._apiKey);
    this.xhr.setRequestHeader("Authorization", "Token " + this._authToken);
    this.xhr.responseType = "blob";

    this.onProgress = onProgress;
    this.xhr.onprogress = function(e) {
      if (instance.onProgress) {
        // Passing e.loaded instead of e.loaded/e.total because e.total
        // is always 0 with gzip compression enabled by the server.
        instance.onProgress(e.loaded);
      }
    };

    var result = new Promise((resolve, reject) => {
      this.toResolve = resolve;
      this.toReject = reject;
    });

    // The blob needs to be saved as file. There is no known way to
    // save the blob as file other than to fake a click on an <a href... download=...>.
    this.xhr.onload = function() {
      if (this.status == 200) {
        var link = document.createElement("a");
        link.href = window.URL.createObjectURL(new Blob([this.response], { type: mimetype }));
        link.style.display = "none";
        link.setAttribute("download", filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(link.href);
        if (instance.toResolve) {
          instance.toResolve();
        }
      } else if (this.status >= 400 && instance.toReject) {
        // The this.responseText is undefined, must use this.response which is a blob.
        // Need to convert this.response to JSON. The blob can only be accessed by the
        // FileReader.
        var reader = new FileReader();
        reader.onload = function() {
          try {
            var pkt = JSON.parse(this.result, jsonParseHelper);
            instance.toReject(new Error(pkt.ctrl.text + " (" + pkt.ctrl.code + ")"));
          } catch(err) {
            console.log("Invalid server response in LargeFileHelper", this.result);
            instance.toReject(err);
          }
        };
        reader.readAsText(this.response);
      }
    };

    this.xhr.onerror = function(e) {
      if (instance.toReject) {
        instance.toReject(new Error("failed"));
      }
    };

    this.xhr.onabort = function() {
      if (instance.toReject) {
        instance.toReject(null);
      }
    };

    try {
      this.xhr.send();
    } catch (err) {
      if (this.toReject) {
        this.toReject(err);
      }
    }

    return result;
  },

  /**
   * Try to cancel an ongoing upload or download.
   * @memberof Tinode.LargeFileHelper#
   */
  cancel: function() {
    if (this.xhr && this.xhr.readyState < 4) {
      this.xhr.abort();
    }
  },

  /**
   * Get unique id of this request.
   * @memberof Tinode.LargeFileHelper#
   *
   * @returns {string} unique id
   */
  getId: function() {
    return this._msgId;
  }
};

/**
 * @class Message - definition a communication message.
 * Work in progress.
 * @memberof Tinode
 *
 * @param {string} topic_ - name of the topic the message belongs to.
 * @param {string | Drafty} content_ - message contant.
 */
var Message = function(topic_, content_) {
  this.status = Message.STATUS_NONE;
  this.topic = topic_;
  this.content = content_;
}

Message.STATUS_NONE     = MESSAGE_STATUS_NONE;
Message.STATUS_QUEUED   = MESSAGE_STATUS_QUEUED;
Message.STATUS_SENDING  = MESSAGE_STATUS_SENDING;
Message.STATUS_SENT     = MESSAGE_STATUS_SENT;
Message.STATUS_RECEIVED = MESSAGE_STATUS_RECEIVED;
Message.STATUS_READ     = MESSAGE_STATUS_READ;
Message.STATUS_TO_ME    = MESSAGE_STATUS_TO_ME;

Message.prototype = {
  /**
   * Convert message object to {pub} packet.
   */
  toJSON: function() {

  },
  /**
   * Parse JSON into message.
   */
  fromJSON: function(json) {

  }
}
Message.prototype.constructor = Message;

module.exports = Tinode.getInstance();
module.exports.Drafty = Drafty;

},{"./drafty.js":1}]},{},[2])(2)
});
