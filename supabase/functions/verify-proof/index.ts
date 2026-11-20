import { serveAuthenticated } from "../_shared/serve.ts";
import { WaxError } from "../_shared/errors.ts";

serveAuthenticated(() => {
  throw new WaxError("not_implemented", "verify-proof is not implemented yet");
});
