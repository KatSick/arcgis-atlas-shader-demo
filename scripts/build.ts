import { $, Glob } from "bun";

const glob = new Glob("**/*.html");
for await (const htmlFile of glob.scan({ cwd: "./src" })) {
  console.log(`>>> Bundling ${htmlFile}`);
  await $`bun build ./src/${htmlFile} --outdir=dist --sourcemap --target=browser --minify --define:process.env.NODE_ENV='\"production\"' --env='BUN_PUBLIC_*'`;
}
