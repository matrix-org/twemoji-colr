#!/usr/bin/env python
import xml.dom.minidom as minidom
import sys

fontfile = sys.argv[1]

# codepoints to monochromise
# to fix https://github.com/element-hq/element-web/issues/14695
monochrome_codepoints = [
    'ua9', 'uae',
    'u2122', 'u2660', 'u2663', 'u25aa',
    'u2714', 'u2716', 'u2734', 'u2795', 'u2796', 'u2797', 'u27b0',
    'u1f4b2', 'u1f519', 'u1f51a', 'u1f51b', 'u1f51c', 'u1f51d', 'u1f7f0',
    'u25fc', 'u25fe', 'u26ab', 'u1f5a4', # solids
    'u3030', # wavy-dash
]

doc = minidom.parse(fontfile)

colr = doc.getElementsByTagName('COLR')[0]
glyf = doc.getElementsByTagName('glyf')[0]
hmtx = doc.getElementsByTagName('hmtx')[0]

for color_glyph in colr.getElementsByTagName('ColorGlyph'):
    # go find the underlying TTGlyph for each layer for each ColorGlyph
    # and combine them into a single TTGlyph named for the base of the ColorGlyph
    # and then delete the ColorGlyph to monochromise it.

    if color_glyph.getAttribute('name') in monochrome_codepoints:
        baseglyph = None
        for ttglyph in glyf.getElementsByTagName('TTGlyph'):
            if ttglyph.getAttribute('name') == color_glyph.getAttribute('name'):
                 baseglyph = ttglyph
                 break
        assert (baseglyph is not None)
        
        # replace the contours of the base glyph with the merged contours of
        # the layer within.
        while baseglyph.firstChild:
            baseglyph.removeChild(baseglyph.firstChild)

        first_layer = True
        for layer in color_glyph.getElementsByTagName('layer'):
            # for the first layer, override the metrics of the base layer to match the first layer.
            if first_layer:
                layer_mtx, base_mtx = (None, None)
                for mtx in hmtx.getElementsByTagName('mtx'):
                    if mtx.getAttribute("name") == layer.getAttribute("name"):
                        layer_mtx = mtx
                    elif mtx.getAttribute("name") == baseglyph.getAttribute("name"):
                        base_mtx = mtx
                assert(layer_mtx is not None)
                assert(base_mtx is not None)
                base_mtx.setAttribute("width", layer_mtx.getAttribute("width"))
                base_mtx.setAttribute("lsb", layer_mtx.getAttribute("lsb"))
                first_layer = False

            for ttglyph in glyf.getElementsByTagName('TTGlyph'):
                if ttglyph.getAttribute('name') == layer.getAttribute('name'):
                    for child in ttglyph.childNodes:
                        # XXX: do we need to worry about different metrics for the contours we smash together here?
                        baseglyph.appendChild(child.cloneNode(deep=True))
                    break

        # then monochromise
        colr.removeChild(color_glyph)

# Save the modified XML
with open(fontfile, 'w', encoding='UTF-8') as f:
    doc.writexml(f, encoding='UTF-8')
