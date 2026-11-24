// Hash routing: #/path/parts. The route signal follows location.hash.
import { signal } from "@preact/signals";

const route = signal(location.hash || "#/");
addEventListener("hashchange", () => {
  route.value = location.hash || "#/";
  scrollTo(0, 0);
});

function go(hash: string) {
  location.hash = hash;
}

export { go, route };
