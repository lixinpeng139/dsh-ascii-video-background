# NOTICE

This plugin's character renderer is a browser reimplementation of the rendering
pipeline in **ASCII-Video** by Kuimuzion:

- https://github.com/Kuimuzion/ASCII-Video
- Copyright © 2026 Kuimuzion
- Licensed under GPL-3.0-only

The embedded 95-character, 16x32 DejaVu Sans Mono bitmap and the brightness,
colour and glyph-ordering constants follow that project. The wallpaper tone
curve raises the gamma and shades dark cells for legibility behind UI text;
that adjustment is specific to this plugin. The browser implementation, WebGL
instancing, settings surface, and Host upload/streaming routes are original work
for this plugin.

The bitmap originates from DejaVu Sans Mono, whose Bitstream Vera license
permits redistribution.

The bundled demonstration video `assets/whale-loop.mp4` is supplied by the
repository maintainer for use as the plugin's default background.
