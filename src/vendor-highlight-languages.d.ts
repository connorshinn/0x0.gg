declare module 'highlightjs-curl' {
  const language: (hljs: any) => any;
  export default language;
}

declare module 'highlightjs-iptables/src/languages/iptables.js' {
  const language: (hljs: any) => any;
  export default language;
}

declare module 'highlightjs-terraform' {
  const language: ((hljs: any) => any) & { definer?: (hljs: any) => any };
  export default language;
}

declare module 'highlightjs-vba/src/vba.js' {
  const language: (hljs: any) => any;
  export default language;
}
