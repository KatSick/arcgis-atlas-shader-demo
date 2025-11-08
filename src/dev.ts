import { serve } from "bun";

const server = serve({
  routes: {
    "/:file": ({ params }) => new Response(Bun.file(`./dist/${params.file}`)),
    "/": () => new Response(Bun.file(`./dist/index.html`)),
  },
});

console.log(`🚀 Server running at ${server.url}`);
