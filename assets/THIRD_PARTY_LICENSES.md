# Third-party Assets

Vizmatic vendors these assets so the CLI and renderer can run without public
runtime fetches.

## CIFAR-10 example

`examples/catalog-image-tensors.tsx` and `examples/catalog-photo-blur.tsx`
contain the same 3,072 RGB bytes from training batch 1, record 0 (frog), plus
their numerical channel views and filtered reconstruction. Source:
https://www.cs.toronto.edu/~kriz/cifar.html. Cite Alex Krizhevsky,
*Learning Multiple Layers of Features from Tiny Images* (2009).

The dataset page does not specify a dataset license. The sample bytes and their
rendered reconstruction are third-party material, not part of Vizmatic's MIT
code license. `node scripts/extract-cifar-sample.mjs` reproduces the exact sample
from the official binary archive without loading pickle or downloading the full
dataset. The reviewed record SHA-256 is
`945dc5584f8efcf7dc58367c3b072c0a23dacc05ae824d7c77a33874a8ec83c7`.

## Fonts

- Inter: SIL Open Font License 1.1.
  Copyright 2016 The Inter Project Authors.
  Source: https://github.com/rsms/inter
- JetBrains Mono: SIL Open Font License 1.1.
  Copyright 2020 The JetBrains Mono Project Authors.
  Source: https://github.com/JetBrains/JetBrainsMono
- Noto Sans: SIL Open Font License 1.1.
  Copyright Google Inc.
  Source: https://github.com/notofonts/noto-fonts
- Noto Sans Math: SIL Open Font License 1.1.
  Copyright 2022 Google LLC. All Rights Reserved.
  Source: https://github.com/notofonts/math

Full license: [`licenses/OFL-1.1.txt`](licenses/OFL-1.1.txt).

The website uses WOFF2 copies of the same Inter and JetBrains Mono font files.
Regenerate them with `pnpm site:fonts`; the original font licenses apply.

## Emoji

- Twemoji SVG assets from `@twemoji/svg@15.0.0`: MIT.
  Copyright (c) 2023 Samuel Kopp.
  Source: https://github.com/boywithkeyboard/twemoji_svg
  Full license: [`licenses/twemoji-svg-MIT.txt`](licenses/twemoji-svg-MIT.txt).

## Browser text shaping

- HarfBuzzJS 0.10.0 JavaScript and `hb.wasm`: MIT, with Apache-2.0 portions
  from Zephyr libc (`zephyr-string.c`) and Emscripten (`emmalloc.cpp`).
  Copyright (c) 2019 Ebrahim Byagowi.
  Source: https://github.com/harfbuzz/harfbuzzjs
  Full notices: [`licenses/harfbuzzjs-LICENSE.txt`](licenses/harfbuzzjs-LICENSE.txt)
  and [`licenses/Apache-2.0.txt`](licenses/Apache-2.0.txt).
