const chalkProxy: any = new Proxy(
  (...args: any[]) => String(args[0] ?? ''),
  {
    get: () => chalkProxy,
    apply: (_target, _thisArg, args) => String(args[0] ?? ''),
  }
);

export default chalkProxy;

