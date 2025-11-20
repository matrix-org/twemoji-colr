#!/usr/bin/env python
import xml.dom.minidom as minidom
import sys

fontfile = sys.argv[1]

# codepoints to monochromise
# to fix https://github.com/element-hq/element-web/issues/14695
# we exclude any with BLACK in the name, to avoid lying about colours
monochrome_codepoints = [
    'ua9', # COPYRIGHT SIGN
    'uae', # REGISTERED SIGN
    'u2122', # TRADE MARK SIGN
    # 'u25aa', # BLACK SMALL SQUARE
    # 'u25fc', # BLACK MEDIUM SQUARE
    # 'u25fe', # BLACK MEDIUM SMALL SQUARE
    # 'u2660', # BLACK SPADE SUIT
    # 'u2663', # BLACK CLUB SUIT
    # 'u26ab', # MEDIUM BLACK CIRCLE
    'u2714', # HEAVY CHECK MARK
    'u2716', # HEAVY MULTIPLICATION X
    # 'u2734', # EIGHT POINTED BLACK STAR
    'u2795', # HEAVY PLUS SIGN
    'u2796', # HEAVY MINUS SIGN
    'u2797', # HEAVY DIVISION SIGN
    'u27b0', # CURLY LOOP
    # 'u2b1b', # BLACK LARGE SQUARE
    'u3030', # WAVY DASH
    'u1f4b2', # HEAVY DOLLAR SIGN
    'u1f519', # BACK WITH LEFTWARDS ARROW ABOVE
    'u1f51a', # END WITH LEFTWARDS ARROW ABOVE
    'u1f51b', # ON WITH EXCLAMATION MARK WITH LEFT RIGHT ARROW ABOVE
    'u1f51c', # SOON WITH RIGHTWARDS ARROW ABOVE
    'u1f51d', # TOP WITH UPWARDS ARROW ABOVE
    'u1f7f0', # HEAVY EQUALS SIGN    
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
