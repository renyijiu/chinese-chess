# Basis Universal GPU Texture Compression

Basis Universal is a "[supercompressed](http://gamma.cs.unc.edu/GST/gst.pdf)"
GPU texture and texture video compression system that outputs a highly
compressed intermediate file format (.basis) that can be quickly transcoded to
a wide variety of GPU texture compression formats.

[GitHub](https://github.com/BinomialLLC/basis_universal)

## Transcoders

Basis Universal texture data may be used in two different file formats:
`.basis` and `.ktx2`, where `ktx2` is a standardized wrapper around basis texture data.

For further documentation about the Basis compressor and transcoder, refer to
the [Basis GitHub repository](https://github.com/BinomialLLC/basis_universal).

The folder contains two files required for transcoding `.basis` or `.ktx2` textures:

* `basis_transcoder.js` — JavaScript wrapper for the WebAssembly transcoder.
* `basis_transcoder.wasm` — WebAssembly transcoder.

Both are dependencies of `KTX2Loader`:

```js
const ktx2Loader = new KTX2Loader();
ktx2Loader.detectSupport( renderer );
ktx2Loader.load( 'diffuse.ktx2', function ( texture ) {

	const material = new THREE.MeshStandardMaterial( { map: texture } );

}, function () {

	console.log( 'onProgress' );

}, function ( e ) {

	console.error( e );

} );
```

## License

[Apache License 2.0](https://github.com/BinomialLLC/basis_universal/blob/master/LICENSE)

## Vendored provenance

These two files are vendored byte-for-byte from `three@0.185.1`
(`three.js` tag `r185`, commit `2431a09f46f34c560bc8e44b33be0e567723d5b9`):

- `basis_transcoder.js` SHA-256:
  `8478b5b6d6b74e7d3082b89f6417321d8d1dc0307f2b30d4484bb11b441696a1`
- `basis_transcoder.wasm` SHA-256:
  `6cf17dc889352c42e9acf8897107978d127005fe3386c36a0e3845e27967630a`

Upstream source: https://github.com/mrdoob/three.js/tree/r185/examples/jsm/libs/basis
