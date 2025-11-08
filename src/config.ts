import { Effect, Schema } from "effect";
import qs from "qs";

const SearchParams = Schema.Struct({
  count: Schema.NumberFromString.annotations({ decodingFallback: () => Effect.succeed(10_000) }),
});

const queryString = qs.parse(window.location.search, { ignoreQueryPrefix: true });

export const config = Schema.decodeUnknownSync(SearchParams)(queryString);

console.debug("decoded config", { queryString, config });
