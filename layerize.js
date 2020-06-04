var fs         = require('fs'),
    rmdir      = require('rmdir'),
    unzip      = require('unzip'),
    xmlbuilder = require('xmlbuilder'),
    xml2js     = require('xml2js');

var sourceZip    = process.argv[2];
var overridesDir = process.argv[3];
var extrasDir    = process.argv[4];
var targetDir    = process.argv[5];
var fontName     = process.argv[6];

var isSbix = true;

if (fontName == undefined) {
    console.error("### Missing font name.");
    console.error("### Usage: node " + process.argv[1] + " source-SVGs.zip overrides-dir extras-dir build-dir font-name");
    return;
}

// Extra ligature rules to support ZWJ sequences that already exist as individual characters
var extraLigatures = JSON.parse(fs.readFileSync(extrasDir + "/ligatures.json"));

var components = {};
// maps svg-data -> glyphName

var chars = [];
// unicode -> components[]
//              color
//              glyphName

var ligatures = [];
// [unicode1, unicode2] -> components[]

var colors = [];
var colorToId = {};

var glyphs = [];
// list of glyph names

var placeholderGlyphs = [
    'u23', // #
    'u2a', // *
    'u30', // 0
    'u31', // 1
    'u32', // 2
    'u33', // 3
    'u34', // 4
    'u35', // 5
    'u36', // 6
    'u37', // 7
    'u38', // 8
    'u39', // 9
    'ufe0f', // VARIATION SELECTOR-16
    'u200d', // ZWJ
    'u20e3', // COMBINING ENCLOSING KEYCAP
];

for (var c=0xe0061; c<=0xe007f; c++) {
    placeholderGlyphs.push('u' + c.toString(16));
}

var curry = function(f) {
    var parameters = Array.prototype.slice.call(arguments, 1);
    return function() {
        return f.apply(this, parameters.concat(
            Array.prototype.slice.call(arguments, 0)
        ));
    };
};

var addToXML = function(xml, p) {
    if (p["#name"] == "g") {
        var g = xml.ele("g", p['$']);
        if (p['$$']) {
            p['$$'].forEach(curry(addToXML, g));
        }
    } else {
        xml.ele(p["#name"], p['$']);
    }
};

var codepoints = [];

function expandColor(c) {
    if (c == undefined) {
        return c;
    }
    c = c.toLowerCase();
    if (c == 'none') {
        return c;
    }
    if (c == 'red') {
        c = '#f00';
    } else if (c == 'green') {
        c = '#008000';
    } else if (c == 'blue') {
        c = '#00f';
    } else if (c == 'navy') {
        c = '#000080';
    }
    // c is a hex color that might be shorthand (3 instead of 6 digits)
    if (c.substr(0, 1) == '#' && c.length == 4) {
        c = '#' + c.substr(1, 1) + c.substr(1, 1)
                + c.substr(2, 1) + c.substr(2, 1)
                + c.substr(3, 1) + c.substr(3, 1);
    }
    if (c) {
        return c + 'ff';
    }
}

function applyOpacity(c, o) {
    if (c == undefined || c == 'none') {
        return c;
    }
    var opacity = o * parseInt(c.substr(7), 16) / 255;
    opacity = Math.round(opacity * 255);
    opacity = opacity.toString(16);
    if (opacity.length == 1) {
        opacity = '0' + opacity;
    }
    return c.substr(0, 7) + opacity;
}

function hexByte(b) {
    var s = b.toString(16);
    if (s.length < 2) {
        s = "0" + s;
    } else if (s.length > 2) { // shouldn't happen
        s = s.substr(s.length - 2, 2);
    }
    return s;
}

function decodePath(d) {
    var x = 0;
    var y = 0;
    var result = [];
    var segStart = [0, 0];
    while (d != "") {
        var matches = d.match("^\s*([MmLlHhVvCcZzSsTtQqAa])");
        if (!matches) {
            break;
        }
        var len = matches[0].length;
        d = d.substr(len);
        var op = matches[1];
        var coords;
        var c = '\\s*(-?(?:[0-9]*\\.[0-9]+|[0-9]+)),?';
        if (op == 'M') {
            segStart = undefined;
            while (coords = d.match('^' + c + c)) {
                d = d.substr(coords[0].length);
                x = Number(coords[1]);
                y = Number(coords[2]);
                if (segStart == undefined) {
                    segStart = [x, y];
                }
                result.push([x, y]);
            }
        } else if (op == 'L') {
            while (coords = d.match('^' + c + c)) {
                d = d.substr(coords[0].length);
                x = Number(coords[1]);
                y = Number(coords[2]);
                result.push([x, y]);
            }
        } else if (op == 'm') {
            segStart = undefined;
            while (coords = d.match('^' + c + c)) {
                d = d.substr(coords[0].length);
                x += Number(coords[1]);
                y += Number(coords[2]);
                if (segStart == undefined) {
                    segStart = [x, y];
                }
                result.push([x, y]);
            }
        } else if (op == 'l') {
            while (coords = d.match('^' + c + c)) {
                d = d.substr(coords[0].length);
                x += Number(coords[1]);
                y += Number(coords[2]);
                result.push([x, y]);
            }
        } else if (op == 'H') {
            while (coords = d.match('^' + c)) {
                d = d.substr(coords[0].length);
                x = Number(coords[1]);
                result.push([x, y]);
            }
        } else if (op == 'h') {
            while (coords = d.match('^' + c)) {
                d = d.substr(coords[0].length);
                x += Number(coords[1]);
                result.push([x, y]);
            }
        } else if (op == 'V') {
            while (coords = d.match('^' + c)) {
                d = d.substr(coords[0].length);
                y = Number(coords[1]);
                result.push([x, y]);
            }
        } else if (op == 'v') {
            while (coords = d.match('^' + c)) {
                d = d.substr(coords[0].length);
                y += Number(coords[1]);
                result.push([x, y]);
            }
        } else if (op == 'C') {
            while (coords = d.match('^' + c + c + c + c + c + c)) {
                d = d.substr(coords[0].length);
                x = Number(coords[1]);
                y = Number(coords[2]);
                result.push([x, y]);
                x = Number(coords[3]);
                y = Number(coords[4]);
                result.push([x, y]);
                x = Number(coords[5]);
                y = Number(coords[6]);
                result.push([x, y]);
            }
        } else if (op == 'c') {
            while (coords = d.match('^' + c + c + c + c + c + c)) {
                d = d.substr(coords[0].length);
                result.push([x + Number(coords[1]), y + Number(coords[2])]);
                result.push([x + Number(coords[3]), y + Number(coords[4])]);
                x += Number(coords[5]);
                y += Number(coords[6]);
                result.push([x, y]);
            }
        } else if (op == 'S') {
            while (coords = d.match('^' + c + c + c + c)) {
                d = d.substr(coords[0].length);
                x = Number(coords[1]);
                y = Number(coords[2]);
                result.push([x, y]);
                x = Number(coords[3]);
                y = Number(coords[4]);
                result.push([x, y]);
            }
        } else if (op == 's') {
            while (coords = d.match('^' + c + c + c + c)) {
                d = d.substr(coords[0].length);
                result.push([x + Number(coords[1]), y + Number(coords[2])]);
                x += Number(coords[3]);
                y += Number(coords[4]);
                result.push([x, y]);
            }
        } else if (op == 'Q') {
            while (coords = d.match('^' + c + c + c + c)) {
                d = d.substr(coords[0].length);
                result.push([x + Number(coords[1]), y + Number(coords[2])]);
                x = Number(coords[3]);
                y = Number(coords[4]);
                result.push([x, y]);
            }
        } else if (op == 'q') {
            while (coords = d.match('^' + c + c + c + c)) {
                d = d.substr(coords[0].length);
                result.push([x + Number(coords[1]), y + Number(coords[2])]);
                x += Number(coords[3]);
                y += Number(coords[4]);
                result.push([x, y]);
            }
        } else if (op == 'T') {
            while (coords = d.match('^' + c + c)) {
                d = d.substr(coords[0].length);
                x = Number(coords[1]);
                y = Number(coords[2]);
                result.push([x, y]);
            }
        } else if (op == 't') {
            while (coords = d.match('^' + c + c)) {
                d = d.substr(coords[0].length);
                x += Number(coords[1]);
                y += Number(coords[2]);
                result.push([x, y]);
            }
        } else if (op == 'A') {
            // we don't fully handle arc, just grab the endpoint
            while (coords = d.match('^' + c + c + c + c + c + c + c)) {
                d = d.substr(coords[0].length);
                x = Number(coords[6]);
                y = Number(coords[7]);
                result.push([x, y]);
            }
        } else if (op == 'a') {
            while (coords = d.match('^' + c + c + c + c + c + c + c)) {
                d = d.substr(coords[0].length);
                x += Number(coords[6]);
                y += Number(coords[7]);
                result.push([x, y]);
            }
        } else if (op == 'Z' || op == 'z') {
            x = segStart[0];
            y = segStart[1];
            result.push([x, y]);
        }
    }
    return result;
}

function getBBox(p) {
    if (p['#name'] == 'path') {
        var points = decodePath(p['$']['d']);
        var result = [undefined, undefined, undefined, undefined];
        points.forEach(function(pt) {
            if (result[0] == undefined || pt[0] < result[0]) { result[0] = pt[0]; }
            if (result[1] == undefined || pt[1] < result[1]) { result[1] = pt[1]; }
            if (result[2] == undefined || pt[0] > result[2]) { result[2] = pt[0]; }
            if (result[3] == undefined || pt[1] > result[3]) { result[3] = pt[1]; }
        });
        return result;
    } else if (p['#name'] == 'circle') {
        var cx = Number(p['$']['cx']);
        var cy = Number(p['$']['cy']);
        var r = Number(p['$']['r']);
        return [cx - r, cy - r, cx + r, cy + r];
    } else if (p['#name'] == 'ellipse') {
        var cx = Number(p['$']['cx']);
        var cy = Number(p['$']['cy']);
        var rx = Number(p['$']['rx']);
        var ry = Number(p['$']['ry']);
        return [cx - rx, cy - ry, cx + rx, cy + ry];
    }
    return [0, 0, 0, 0];
}

function overlap(a, b) {
    if (a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]) {
        return false;
    } else {
        return true;
    }
}

function hasTransform(p) {
    return p['$']['transform'] !== undefined;
}

function addOrMerge(paths, p, color) {
    var i = -1;
    if (!hasTransform(p)) {
        i = paths.length - 1;
        var bbox = getBBox(p);
        while (i >= 0) {
            var hasOverlap = false;
            paths[i].paths.forEach(function(pp) {
                if (hasTransform(pp) || overlap(bbox, getBBox(pp))) {
                    hasOverlap = true;
                }
            });
            if (hasOverlap) {
                i = -1;
                break;
            }
            if (paths[i].color == color) {
                break;
            }
            --i;
        }
    }
    if (i >= 0) {
        paths[i].paths.push(p);
    } else {
        paths.push({color: color, paths: [p]});
    }
}

function recordGradient(g, urlColor) {
    var stops = [];
    var id = '#' + g['$']['id'];
    g['$$'].forEach(function (child) {
        if (child['#name'] == "stop") {
            stops.push(expandColor(child['$']['stop-color']));
        }
    });
    var stopCount = stops.length;
    var r = 0, g = 0, b = 0;
    if (stopCount > 0) {
        stops.forEach(function (stop) {
            r = r + parseInt(stop.substr(1, 2), 16);
            g = g + parseInt(stop.substr(3, 2), 16);
            b = b + parseInt(stop.substr(5, 2), 16);
        });
        r = Math.round(r / stopCount);
        g = Math.round(g / stopCount);
        b = Math.round(b / stopCount);
    }
    var color = "#" + hexByte(r) + hexByte(g) + hexByte(b);
    urlColor[id] = color;
}

function processFile(fileName, data) {
    // strip .svg extension off the name
    var baseName = fileName.replace(".svg", "");
    // Twitter doesn't include the VS16 in the keycap filenames
    if (/^[23][0-9a]-20e3$/.test(baseName)) {
        var orig = baseName;
        baseName = baseName.replace('-20e3', '-fe0f-20e3');
        fs.symlink(`${orig}.png`, `72x72/${baseName}.png`, ()=>{});
        console.log(`found mis-named keycap ${orig}, renamed to ${baseName}`);
    } else if (baseName == '1f441-200d-1f5e8') {
        // ...or in the "eye in speech bubble"'s
        var orig = baseName;
        baseName = '1f441-fe0f-200d-1f5e8-fe0f';
        fs.symlink(`${orig}.png`, `72x72/${baseName}.png`, ()=>{});
        console.log(`found mis-named 1f441-200d-1f5e8, renamed to ${baseName}`);
    }

    // split name of glyph that corresponds to multi-char ligature
    var unicodes = baseName.split("-");

    if (isSbix) {
        if (unicodes.length == 1) {
            // simple character (single codepoint)
            chars.push({unicode: unicodes[0]});
            glyphs.push('u' + unicodes[0]);
        } else {
            ligatures.push({unicodes: unicodes});
            glyphs.push('u' + unicodes.join("_"));
            codepoints.push('"u' + unicodes.join("_") + '": -1');
        }
        unicodes.forEach(function(u) {
            codepoints.push('"u' + u + '": ' + parseInt(u, 16));
        });
        return;
    }

    var parser = new xml2js.Parser({preserveChildrenOrder: true,
                                    explicitChildren: true,
                                    explicitArray: true});

    // Save the original file also for visual comparison
    fs.writeFileSync(targetDir + "/colorGlyphs/u" + baseName + ".svg", data);

    parser.parseString(data, function (err, result) {
        var paths = [];
        var defs = {};
        var urlColor = {};

        var addToPaths = function(defaultFill, defaultStroke, defaultOpacity,
                                  defaultStrokeWidth, xform, elems) {
            elems.forEach(function (e) {

                if (e['#name'] == 'metadata') {
                    e = undefined;
                    return;
                }

                if (e['#name'] == 'defs') {
                    if (e['$$'] != undefined) {
                        e['$$'].forEach(function (def) {
                            if (def['#name'] == 'linearGradient') {
                                recordGradient(def, urlColor);
                            } else {
                                var id = '#' + def['$']['id'];
                                defs[id] = def;
                            }
                        })
                    }
                    return;
                }

                if (e['#name'] == 'linearGradient') {
                    recordGradient(e, urlColor);
                    return;
                }

                if (e['$'] == undefined) {
                    e['$'] = {};
                }

                var fill = e['$']['fill'];
                var stroke = e['$']['stroke'];
                var strokeWidth = e['$']['stroke-width'] || defaultStrokeWidth;

                // any path with an 'id' might get re-used, so remember it
                if (e['$']['id']) {
                    var id = '#' + e['$']['id'];
                    defs[id] = JSON.parse(JSON.stringify(e));
                }

                var t = e['$']['transform'];
                if (t) {
                    // fontforge import doesn't understand 3-argument 'rotate',
                    // so we decompose it into translate..rotate..untranslate
                    var c = '(-?(?:[0-9]*\\.[0-9]+|[0-9]+))';
                    while (true) {
                        var m = t.match('rotate\\(' + c + '\\s+' + c + '\\s' + c + '\\)');
                        if (!m) {
                            break;
                        }
                        var a = Number(m[1]);
                        var x = Number(m[2]);
                        var y = Number(m[3]);
                        var rep = 'translate(' + x + ' ' + y + ') ' +
                                  'rotate(' + a + ') ' +
                                  'translate(' + (-x) + ' ' + (-y) + ')';
                        t = t.replace(m[0], rep);
                    }
                    e['$']['transform'] = t;
                }

                if (fill && fill.substr(0, 3) == "url") {
                    var id = fill.substr(4, fill.length - 5);
                    if (urlColor[id] == undefined) {
                        console.log('### ' + baseName + ': no mapping for ' + fill);
                    } else {
                        fill = urlColor[id];
                    }
                }
                if (stroke && stroke.substr(0, 3) == "url") {
                    var id = stroke.substr(4, stroke.length - 5);
                    if (urlColor[id] == undefined) {
                        console.log('### ' + baseName + ': no mapping for ' + stroke);
                    } else {
                        stroke = urlColor[id];
                    }
                }

                fill = expandColor(fill);
                stroke = expandColor(stroke);

                fill = fill || defaultFill;
                stroke = stroke || defaultStroke;

                var opacity = (e['$']['opacity'] || 1.0) * defaultOpacity;

                if (e['#name'] == 'g') {
                    if (e['$$'] != undefined) {
                        addToPaths(fill, stroke, opacity, strokeWidth, e['$']['transform'] || xform, e['$$']);
                    }
                } else if (e['#name'] == 'use') {
                    var href = e['$']['xlink:href'];
                    var target = defs[href];
                    if (target) {
                        addToPaths(fill, stroke, opacity, strokeWidth, e['$']['transform'] || xform,
                                   [JSON.parse(JSON.stringify(target))]);
                    }
                } else {
                    if (!e['$']['transform'] && xform) {
                        e['$']['transform'] = xform;
                    }
                    if (fill != 'none') {
                        var f = JSON.parse(JSON.stringify(e));
                        f['$']['stroke'] = 'none';
                        f['$']['stroke-width'] = '0';
                        f['$']['fill'] = '#000';
                        if (opacity != 1.0) {
                            fill = applyOpacity(fill, opacity);
                        }
                        // Insert a Closepath before any Move commands within the path data,
                        // as fontforge import doesn't handle unclosed paths reliably.
                        if (f['#name'] == 'path') {
                            var d = f['$']['d'];
                            d = d.replace(/M/g, 'zM').replace(/m/g, 'zm').replace(/^z/, '').replace(/zz/gi, 'z');
                            if (f['$']['d'] != d) {
                                f['$']['d'] = d;
                            }
                        }
                        addOrMerge(paths, f, fill);
                    }

                    // fontforge seems to hang on really complex thin strokes
                    // so we arbitrarily discard them for now :(
                    // Also skip stroking the zodiac-sign glyphs to work around
                    // conversion problems with those outlines; we'll just have
                    // slightly thinner symbols (fill only, no stroke)
                    function skipStrokeOnZodiacSign(u) {
                        u = parseInt(u, 16);
                        return (u >= 0x2648 && u <= 0x2653);
                    }
                    if (stroke != 'none' && !skipStrokeOnZodiacSign(unicodes[0])) {
                        if (e['#name'] != 'path' || Number(strokeWidth) > 0.25 ||
                            (e['$']['d'].length < 500 && Number(strokeWidth) > 0.1)) {
                            var s = JSON.parse(JSON.stringify(e));
                            s['$']['fill'] = 'none';
                            s['$']['stroke'] = '#000';
                            s['$']['stroke-width'] = strokeWidth;
                            if (opacity) {
                                stroke = applyOpacity(stroke, opacity);
                            }
                            addOrMerge(paths, s, stroke);
                        } else {
                            //console.log("Skipping stroke in " + baseName + ", color " + stroke + " width " + strokeWidth);
                            //console.log(e['$']);
                        }
                    }
                }
            });
        };

        addToPaths('#000000ff', 'none', 1.0, '1', undefined, result['svg']['$$']);

        var layerIndex = 0;
        var layers = [];
        paths.forEach(function(path) {
            var svg = xmlbuilder.create("svg");
            for (var i in result['svg']['$']) {
                svg.att(i, result['svg']['$'][i]);
            }

            path.paths.forEach(curry(addToXML, svg));
            var svgString = svg.toString();

            // see if there's an already-defined component that matches this shape
            var glyphName = components[svgString];

            // if not, create a new component glyph for this layer
            if (glyphName == undefined) {
                glyphName = baseName + "_layer" + layerIndex;
                components[svgString] = glyphName;
                codepoints.push('"u' + glyphName + '": -1');
                fs.writeFileSync(targetDir + "/glyphs/u" + glyphName + ".svg", svgString);
            }

            // add to the glyph's list of color layers
            layers.push({color: path.color, glyphName: glyphName});

            // if we haven't seen this color before, add it to the palette
            if (colorToId[path.color] == undefined) {
                colorToId[path.color] = colors.length;
                colors.push(path.color);
            }
            layerIndex = layerIndex + 1;
        });

        if (unicodes.length == 1) {
            // simple character (single codepoint)
            chars.push({unicode: unicodes[0], components: layers});
        } else {
            ligatures.push({unicodes: unicodes, components: layers});
            // create the placeholder glyph for the ligature (to be mapped to a set of color layers)
            fs.writeFileSync(targetDir + "/glyphs/u" + unicodes.join("_") + ".svg",
                             '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36"><rect width="36" height="36"/></svg>');
            codepoints.push('"u' + unicodes.join("_") + '": -1');
        }
        unicodes.forEach(function(u) {
            // make sure we have a placeholder glyph for the individual character, or for each component of the ligature
            fs.writeFileSync(targetDir + "/glyphs/u" + u + ".svg",
                             '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36"><rect width="36" height="36"/></svg>');
            codepoints.push('"u' + u + '": ' + parseInt(u, 16));
        });
    });
}

function generateTTX() {
    // After we've processed all the source SVGs, we'll generate the auxiliary
    // files needed for OpenType font creation.
    // We also save the color-layer info in a separate JSON file, for the convenience
    // of the test script.

    var layerInfo = {};

    var ttFont = xmlbuilder.create("ttFont");
    ttFont.att("sfntVersion", "\\x00\\x01\\x00\\x00");
    ttFont.att("ttLibVersion", "3.0");

    if (isSbix) {
        placeholderGlyphs.forEach(glyph=>{
            chars.push({unicode: glyph.slice(1)});
            glyphs.push(glyph);
        });

        // headers stolen from https://github.com/RoelN/ChromaCheck/tree/master/src
        // they are also the sfnt-required tables from
        // https://developer.apple.com/fonts/TrueType-Reference-Manual/RM06/Chap6.html
        var width = 800; // based on Apple Color Emoji, and ChromaCheck
        var kerning = 40;

        var maxp = ttFont.ele("maxp");
        maxp.ele("tableVersion", {value: "0x10000"});
        maxp.ele("numGlyphs", {value: 0}); // let ttx figure it out - 2892
        maxp.ele("maxPoints", {value: 0}); // let ttx figure it out - 4
        maxp.ele("maxContours", {value: 0});  // let ttx figure it out -1
        maxp.ele("maxCompositePoints", {value: 0});
        maxp.ele("maxCompositeContours", {value: 0});
        maxp.ele("maxZones", {value: 1});
        maxp.ele("maxTwilightPoints", {value: 0});
        maxp.ele("maxStorage", {value: 0});
        maxp.ele("maxFunctionDefs", {value: 10});
        maxp.ele("maxInstructionDefs", {value: 0});
        maxp.ele("maxStackElements", {value: 512});
        maxp.ele("maxSizeOfInstructions", {value: 24});
        maxp.ele("maxComponentElements", {value: 0});
        maxp.ele("maxComponentDepth", {value: 0});

        var name = ttFont.ele("name");
        name.ele("namerecord", {nameID: 0, platformID: 1, platEncID: 0, langID: '0x0'}, '(c) 2016-2018 Mozilla Foundation');
        name.ele("namerecord", {nameID: 1, platformID: 1, platEncID: 0, langID: '0x0'}, 'Twemoji Mozilla');
        name.ele("namerecord", {nameID: 2, platformID: 1, platEncID: 0, langID: '0x0'}, 'Regular');
        name.ele("namerecord", {nameID: 3, platformID: 1, platEncID: 0, langID: '0x0'}, 'Twemoji Mozilla SBIX Variant');
        name.ele("namerecord", {nameID: 4, platformID: 1, platEncID: 0, langID: '0x0'}, 'Twemoji Mozilla');
        name.ele("namerecord", {nameID: 5, platformID: 1, platEncID: 0, langID: '0x0'}, 'Version 1.000');
        name.ele("namerecord", {nameID: 6, platformID: 1, platEncID: 0, langID: '0x0'}, 'TwemojiMozilla');

        // needed to pass macOS's FontBook validation, at least
        var post = ttFont.ele("post");
        post.ele("formatType", {value: "2.0"});
        post.ele("italicAngle", {value: "0.0"});
        post.ele("underlinePosition", {value: "0"});
        post.ele("underlineThickness", {value: "0"});
        post.ele("isFixedPitch", {value: "0"});
        post.ele("minMemType42", {value: "0"});
        post.ele("maxMemType42", {value: "0"});
        post.ele("minMemType1", {value: "0"});
        post.ele("maxMemType1", {value: "0"});
        post.ele("psNames");
        post.ele("extraNames");

        // needed to be rendered as a webfont. yay OS/2.
        // this taken from the Glyphs.app output of saving the font.
        var os_2 = ttFont.ele("OS_2");
        os_2.ele("version", {value: "3"});
        os_2.ele("xAvgCharWidth", {value: "840"});
        os_2.ele("usWeightClass", {value: "400"});
        os_2.ele("usWidthClass", {value: "5"});
        os_2.ele("fsType", {value: "00000000 00001000"});
        os_2.ele("ySubscriptXSize", {value: "520"});
        os_2.ele("ySubscriptYSize", {value: "480"});
        os_2.ele("ySubscriptXOffset", {value: "0"});
        os_2.ele("ySubscriptYOffset", {value: "60"});
        os_2.ele("ySuperscriptXSize", {value: "520"});
        os_2.ele("ySuperscriptYSize", {value: "480"});
        os_2.ele("ySuperscriptXOffset", {value: "0"});
        os_2.ele("ySuperscriptYOffset", {value: "280"});
        os_2.ele("yStrikeoutSize", {value: "50"});
        os_2.ele("yStrikeoutPosition", {value: "300"});
        os_2.ele("sFamilyClass", {value: "0"});
        os_2.ele("ulUnicodeRange1", {value: "00000000 00000000 00000000 00000000"});
        os_2.ele("ulUnicodeRange2", {value: "00000010 00000000 00000000 00000000"});
        os_2.ele("ulUnicodeRange3", {value: "00000000 00000000 00000000 00000000"});
        os_2.ele("ulUnicodeRange4", {value: "00000000 00000000 00000000 00000000"});
        os_2.ele("achVendID", {value: "UKWN"});
        os_2.ele("fsSelection", {value: "00000000 01000000"});
        os_2.ele("usFirstCharIndex", {value: "32"});
        os_2.ele("usLastCharIndex", {value: "65535"});
        os_2.ele("sTypoAscender", {value: "800"});
        os_2.ele("sTypoDescender", {value: "0"});
        os_2.ele("sTypoLineGap", {value: "160"});
        os_2.ele("usWinAscent", {value: "960"});
        os_2.ele("usWinDescent", {value: "0"});
        os_2.ele("ulCodePageRange1", {value: "00000000 00000000 00000000 00000001"});
        os_2.ele("ulCodePageRange2", {value: "00000000 00000000 00000000 00000000"});
        os_2.ele("sxHeight", {value: "500"});
        os_2.ele("sCapHeight", {value: "700"});
        os_2.ele("usDefaultChar", {value: "0"});
        os_2.ele("usBreakChar", {value: "32"});
        os_2.ele("usMaxContext", {value: "8"});

        var panose = os_2.ele("panose");
        panose.ele("bFamilyType", {value: "0"});
        panose.ele("bSerifStyle", {value: "0"});
        panose.ele("bWeight", {value: "5"});
        panose.ele("bProportion", {value: "0"});
        panose.ele("bContrast", {value: "0"});
        panose.ele("bStrokeVariation", {value: "0"});
        panose.ele("bArmStyle", {value: "0"});
        panose.ele("bLetterForm", {value: "0"});
        panose.ele("bMidline", {value: "0"});
        panose.ele("bXHeight", {value: "0"});

        var glyphOrder = ttFont.ele("GlyphOrder");
        var i = 0;
        glyphOrder.ele("GlyphID", { id: i++, name: '.notdef' });
        glyphs.forEach(glyph => {
            glyphOrder.ele("GlyphID", {
                id: i++,
                name: glyph,
            })
        });

        var head = ttFont.ele("head");
        head.ele("tableVersion", {value: "1.0"});
        head.ele("fontRevision", {value: "1.0"});
        head.ele("checkSumAdjustment", {value: "0x00000000"}); // gets fixed up by ttx
        head.ele("magicNumber", {value: "0x5F0F3CF5"});
        head.ele("flags", {value: "00000000 00011011"}); // XXX check these
        head.ele("unitsPerEm", {value: width});
        head.ele("created", {value: "Sun May 31 13:19:00 2020"});
        head.ele("modified", {value: "Sun May 31 13:19:00 2020"});
        head.ele("xMin", {value: "0"});
        head.ele("yMin", {value: "0"});
        head.ele("xMax", {value: width});
        head.ele("yMax", {value: width});
        head.ele("macStyle", {value: "00000000 00000000"});
        head.ele("lowestRecPPEM", {value: "8"});
        head.ele("fontDirectionHint", {value: "2"});
        head.ele("indexToLocFormat", {value: "0"});
        head.ele("glyphDataFormat", {value: "0"});

        var hhea = ttFont.ele("hhea");
        hhea.ele("tableVersion", {value: "0x00010000"});
        hhea.ele("ascent", {value: width});
        hhea.ele("descent", {value: "0"});
        hhea.ele("lineGap", {value: "0"});
        hhea.ele("advanceWidthMax", {value: width});
        hhea.ele("minLeftSideBearing", {value: "0"});
        hhea.ele("minRightSideBearing", {value: "0"});
        hhea.ele("xMaxExtent", {value: width});
        hhea.ele("caretSlopeRise", {value: "1"});
        hhea.ele("caretSlopeRun", {value: "0"});
        hhea.ele("caretOffset", {value: "0"});
        hhea.ele("reserved0", {value: "0"});
        hhea.ele("reserved1", {value: "0"});
        hhea.ele("reserved2", {value: "0"});
        hhea.ele("reserved3", {value: "0"});
        hhea.ele("metricDataFormat", {value: "0"});
        hhea.ele("numberOfHMetrics", {value: glyphs.length + 1}); // +1 for .notdef

        var cmap = ttFont.ele("cmap");
        cmap.ele("tableVersion", {version: "0"});
        // apparently we need to dump the table 4 times, first 16-bit, then 32-bit, then again per platform.
        // <cmap_format_4 platformID="0" platEncID="3" language="0">
        // <cmap_format_12 platformID="0" platEncID="4" format="12" reserved="0" length="12640" language="0" nGroups="1052">
        // <cmap_format_4 platformID="3" platEncID="1" language="0">
        // <cmap_format_12 platformID="3" platEncID="10" format="12" reserved="0" length="12640" language="0" nGroups="1052">

        var cmap1 = cmap.ele("cmap_format_4", {
            platformID: 0,
            platEncID: 3,
            language: 0,
        });
        var cmap2 = cmap.ele("cmap_format_12", {
            platformID: 0,
            platEncID: 4,
            format: 12,
            reserved: 0,
            length: 0, // fixed up by ttx
            language: 0,
            nGroups: 0, // fixed up by ttx
        });
        var cmap3 = cmap.ele("cmap_format_4", {
            platformID: 3,
            platEncID: 1,
            language: 0,
        });
        var cmap4 = cmap.ele("cmap_format_12", {
            platformID: 3,
            platEncID: 10,
            format: 12,
            reserved: 0,
            length: 0, // fixed up by ttx
            language: 0,
            nGroups: 0, // fixed up by ttx
        });
        chars.forEach(ch=>{
            if (ch.unicode.length <= 4) {
                cmap1.ele("map", {
                    code: '0x' + ch.unicode,
                    name: 'u' + ch.unicode,
                });
                cmap3.ele("map", {
                    code: '0x' + ch.unicode,
                    name: 'u' + ch.unicode,
                });
            }
            cmap2.ele("map", {
                code: '0x' + ch.unicode,
                name: 'u' + ch.unicode,
            });
            cmap4.ele("map", {
                code: '0x' + ch.unicode,
                name: 'u' + ch.unicode,
            });
        });

        var loca = ttFont.ele("loca");
        var glyf = ttFont.ele("glyf");
        var hmtx = ttFont.ele("hmtx");
        glyf.ele("TTGlyph", { name: '.notdef' });
        hmtx.ele("mtx", { name: '.notdef', width: width + kerning, lsb: 0 });
        glyphs.forEach(function(glyph) {
            var ttglyph = glyf.ele("TTGlyph", {
                name: glyph,
                xMin: 0,
                yMin: 0,
                xMax: width,
                yMax: width,
            });
            var contour = ttglyph.ele("contour");
            contour.ele("pt", { x: 0, y: width-100, on: 1 });
            contour.ele("pt", { x: width, y: width-100, on: 1 });
            contour.ele("pt", { x: width, y: -100, on: 1 });
            contour.ele("pt", { x: 0, y: -100, on: 1 });
            // contour.ele("pt", { x: 0, y: -100, on: 1 }); // -100 to vertically center within x-height
            // contour.ele("pt", { x: width, y: width - 100, on: 1 });
            ttglyph.ele("instructions");

            hmtx.ele("mtx", {
                name: glyph,
                width: width + kerning,
                lsb: 0,
            })
        });

        var sbix = ttFont.ele("sbix");
        sbix.ele("version", {value: 1});
        sbix.ele("flags", {value: "00000000 00000001"});
        var strike = sbix.ele("strike");
        strike.ele("ppem", {value: 72});
        strike.ele("resolution", {value: 72});
        strike.ele("glyph", { name: '.notdef' });
        chars.forEach(function(ch) {
            try {
                var data = fs.readFileSync("72x72/" + ch.unicode + ".png");
                var glyph = strike.ele("glyph", {
                    graphicType: "png ",
                    name: "u" + ch.unicode,
                    originOffsetX: 0,
                    originOffsetY: 0,
                });
                var hex = [];
                for (const byte of data) {
                    hex.push(byte.toString(16).padStart(2, '0'));
                }
                glyph.ele("hexdata", hex.join(''));
            }
            catch(e) {
                strike.ele("glyph", { name: 'u' + ch.unicode });
            }
        });
        ligatures.forEach(function(lig) {
            var glyph = strike.ele("glyph", {
                graphicType: "png ",
                name: "u" + lig.unicodes.join("_"),
                originOffsetX: 0,
                originOffsetY: 0,
            });
            var data = fs.readFileSync("72x72/" + lig.unicodes.join("-") + ".png");
            var hex = [];
            for (const byte of data) {
                hex.push(byte.toString(16).padStart(2, '0'));
            }
            glyph.ele("hexdata", hex.join(''));
        });
    }
    else {
        // COLR table records the color layers that make up each colored glyph
        var COLR = ttFont.ele("COLR");
        COLR.ele("version", {value: 0});
        chars.forEach(function(ch) {
            var colorGlyph = COLR.ele("ColorGlyph", {name: "u" + ch.unicode});
            ch.components.forEach(function(cmp) {
                colorGlyph.ele("layer", {colorID: colorToId[cmp.color], name: "u" + cmp.glyphName});
            });
            layerInfo[ch.unicode] = ch.components.map(function(cmp) { return "u" + cmp.glyphName; });
        });
        ligatures.forEach(function(lig) {
            var colorGlyph = COLR.ele("ColorGlyph", {name: "u" + lig.unicodes.join("_")});
            lig.components.forEach(function(cmp) {
                colorGlyph.ele("layer", {colorID: colorToId[cmp.color], name: "u" + cmp.glyphName});
            });
            layerInfo[lig.unicodes.join("_")] = lig.components.map(function(cmp) { return "u" + cmp.glyphName; });
        });
        fs.writeFileSync(targetDir + "/layer_info.json", JSON.stringify(layerInfo, null, 2));

        // CPAL table maps color index values to RGB colors
        var CPAL = ttFont.ele("CPAL");
        CPAL.ele("version", {value: 0});
        CPAL.ele("numPaletteEntries", {value: colors.length});
        var palette = CPAL.ele("palette", {index: 0});
        var index = 0;
        colors.forEach(function(c) {
            if (c.substr(0, 3) == "url") {
                console.log("unexpected color: " + c);
                c = "#000000ff";
            }
            palette.ele("color", {index: index, value: c});
            index = index + 1;
        });
    }

    // GSUB table implements the ligature rules for Regional Indicator pairs and emoji-ZWJ sequences
    var GSUB = ttFont.ele("GSUB");
    GSUB.ele("Version", {value: "0x00010000"});

    var scriptRecord = GSUB.ele("ScriptList").ele("ScriptRecord", {index: 0});
    scriptRecord.ele("ScriptTag", {value: "DFLT"});

    var defaultLangSys = scriptRecord.ele("Script").ele("DefaultLangSys");
    defaultLangSys.ele("ReqFeatureIndex", {value: 65535});
    defaultLangSys.ele("FeatureIndex", {index: 0, value: 0});

    // The ligature rules are assigned to the "ccmp" feature (*not* "liga"),
    // as they should not be disabled in contexts such as letter-spacing or
    // inter-character justification, where "normal" ligatures are turned off.
    var featureRecord = GSUB.ele("FeatureList").ele("FeatureRecord", {index: 0});
    featureRecord.ele("FeatureTag", {value: "ccmp"});
    featureRecord.ele("Feature").ele("LookupListIndex", {index: 0, value: 0});

    var lookup = GSUB.ele("LookupList").ele("Lookup", {index: 0});
    lookup.ele("LookupType", {value: 4});
    lookup.ele("LookupFlag", {value: 0});
    var ligatureSubst = lookup.ele("LigatureSubst", {index: 0, Format: 1});
    var ligatureSets = {};
    var ligatureSetKeys = [];
    var addLigToSet = function(lig) {
        var startGlyph = "u" + lig.unicodes[0];
        var components = "u" + lig.unicodes.slice(1).join(",u");
        var glyphName = lig.glyphName || "u" + lig.unicodes.join("_");
        if (ligatureSets[startGlyph] == undefined) {
            ligatureSetKeys.push(startGlyph);
            ligatureSets[startGlyph] = [];
        }
        ligatureSets[startGlyph].push({components: components, glyph: glyphName});
    }
    ligatures.forEach(addLigToSet);
    extraLigatures.forEach(addLigToSet);
    ligatureSetKeys.sort();
    ligatureSetKeys.forEach(function(glyph) {
        var ligatureSet = ligatureSubst.ele("LigatureSet", {glyph: glyph});
        var set = ligatureSets[glyph];
        // sort ligatures with more components first
        set.sort(function(a, b) {
            return b.components.length - a.components.length;
        });
        set.forEach(function(lig) {
            ligatureSet.ele("Ligature", {components: lig.components, glyph: lig.glyph});
        });
    });

    var ttx = fs.createWriteStream(targetDir + "/" + fontName + ".ttx");
    ttx.write('<?xml version="1.0" encoding="UTF-8"?>\n');
    ttx.write(ttFont.toString());
    ttx.end();

    // Write out the codepoints file to control character code assignments by grunt-webfont
    fs.writeFileSync(targetDir + "/codepoints.js", "{\n" + codepoints.join(",\n") + "\n}\n");
}

// Delete and re-create target directory, to remove any pre-existing junk
rmdir(targetDir, function() {
    fs.mkdirSync(targetDir);
    fs.mkdirSync(targetDir + "/glyphs");
    fs.mkdirSync(targetDir + "/colorGlyphs");

    // Read glyphs from the "extras" directory
    var extras = fs.readdirSync(extrasDir);
    extras.forEach(function(f) {
        if (f.endsWith(".svg")) {
            var data = fs.readFileSync(extrasDir + "/" + f);
            processFile(f, data);
        }
    });

    // Get list of glyphs in the "overrides" directory, which will be used to replace
    // same-named glyphs from the main source archive
    var overrides = fs.readdirSync(overridesDir);

    // Finally, we're ready to process the images from the main source archive:
    fs.createReadStream(sourceZip).pipe(unzip.Parse()).on('entry', function (e) {
        var data = "";
        var fileName = e.path.replace(/^.*\//, ""); // strip any directory names
        if (e.type == 'File') {
            // Check for an override; if present, read that instead
            var o = overrides.indexOf(fileName);
            if (o >= 0) {
                console.log("overriding " + fileName + " with local copy");
                data = fs.readFileSync(overridesDir + "/" + fileName);
                processFile(fileName, data);
                overrides.splice(o, 1);
                e.autodrain();
            } else {
                e.on("data", function (c) {
                    data += c.toString();
                });
                e.on("end", function () {
                    processFile(fileName, data);
                });
            }
        } else {
            e.autodrain();
        }
    }).on('close', generateTTX);
});
