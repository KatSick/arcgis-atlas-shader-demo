import esriConfig from "@arcgis/core/config";

export function installArcGisDictionaryInterceptor(
  url: string,
  dictionaryCache: Record<string, any>,
): void {
  const regexSidc = /styles\/cim\/(.*)\.json/;

  esriConfig.request.interceptors?.push({
    urls: new RegExp(url),
    before({ url }: { url: string }) {
      if (url.includes("dictionary-info")) {
        return dictionaryCache["dictionary-info"];
      }

      const [, dictionarySidcKey] = regexSidc.exec(url)!;
      if (!dictionarySidcKey) return;

      return dictionaryCache[dictionarySidcKey];
    },
  });
}
