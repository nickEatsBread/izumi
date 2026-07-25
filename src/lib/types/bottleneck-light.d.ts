// `bottleneck/light` is the browser build — same public API as the main entry, but without the
// Redis datastores (see the import comment in $lib/anilist/client.ts). The package ships types only
// for its root entry, so point the subpath at them.
declare module 'bottleneck/light' {
  import Bottleneck from 'bottleneck'
  export default Bottleneck
  export * from 'bottleneck'
}
