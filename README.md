# twemoji-colr

Project to create a COLR/CPAL-based color OpenType font
from the [Twemoji](https://twitter.github.io/twemoji/) collection of emoji images.

Note that the resulting font will **only** be useful on systems that support
layered color TrueType fonts; this includes Windows 8.1 and later,
as well as Mozilla Firefox and other Gecko-based applications running on
any platform.

Systems that do not support such color fonts will show blank glyphs
if they try to use this font.

## Getting started

This project makes use of [grunt-webfont](https://github.com/sapegin/grunt-webfont)
and an additional [node.js](https://nodejs.org/en/) script.
Therefore, installation of Node.js (and the package manager [yarn](https://classic.yarnpkg.com/en/)) is a prerequisite.
Grunt will be installed as a package dependency — no need to install it globally.

The necessary tools can be installed via yarn:

    # install dependencies from packages.json, including `grunt-webfont`.
    yarn

The build process also requires [fontforge](https://fontforge.github.io/)
and the TTX script from the [font-tools](https://github.com/behdad/fonttools/) package to be installed, and assumes standard Perl and Python are available.

Both FontForge and font-tools can be installed via `homebrew` on OS X, or package managers on Linux:

    # OS X
    brew install fonttools fontforge

    # Ubuntu, for example
    sudo apt-get install fonttools fontforge python-fontforge

## Building the font

Once the necessary build tools are all in place, simply running

    make

should build the color-emoji font `build/Twemoji Mozilla.ttf` from the source SVG files found in `twe-svg.zip` file and `extras`, `overrides` directories.

N.B. make sure your python is pointed at the right one required by fontforge (e.g. 3.8)

You can then compress this into a WOFF via `woff2_compress`

## sbix support

This branch contains a fairly ugly attempt to support emitting an sbix font as an alternative
to COLR/CPAL.  For this to work:

 * Grab the latest twemoji release from https://github.com/twitter/twemoji/releases
 * Expand it and symlink the `2/72x72` (or `assets/72x72` for twemoji 13) directory into this checkout
 * Create a new twe-svg.zip: `mv twe-svg.zip twe-svg.zip.old; zip -rj twe-svg.zip twemoji-13.0.0/assets/svg`
 * Check that `isSbix = true` in layerize.js
 * Run the layerize manually (no need to run `make`):
   `node layerize.js twe-svg.zip overrides extras build twemoji-sbix && ttx -o build/twemoji-sbix.ttf build/twemoji-sbix.ttx`

This involves an awful lot of hardcoded sfnt sections, which have been cargoculted from:
 * https://github.com/RoelN/ChromaCheck (to get a general idea of sbix fonts)
 * http://www.typophile.com/node/103268 (to work out why FontBook wouldn't validate correctly (no `post` section))
 * Apple Emoji Color (to compare their font metrics)
 * the output of Glyphs.app when loading & saving our ttf to normalise it (`post`, `OS/2`, `cmap` sections)

Earlier versions of this relied on normalising the TTF via Glyphs to fix up the sections; however, this ran into the problems of:
 * https://forum.glyphsapp.com/t/crash-in-makeotfglyphs/11786 (Glyphs crashes on long glyph names, even though it derived them itself)
 * https://forum.glyphsapp.com/t/pngs-in-sbix-exports-are-converted-from-8-bit-palette-to-32-bit-rgba/11787 (Glyphs expands PNGs from 8-bit to 32-bit on export)

...so instead, layerize has been fixed up to generate TTX which looks to work in practice.