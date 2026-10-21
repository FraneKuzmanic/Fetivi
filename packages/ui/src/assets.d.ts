// Asset imports the apps' bundler (Vite) resolves: stylesheets for their side effect, `?url` as a URL.
declare module '*.css';
declare module '*?url' {
  const url: string;
  export default url;
}
