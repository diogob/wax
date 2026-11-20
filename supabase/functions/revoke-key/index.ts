import { serveAuthenticated } from "../_shared/serve.ts";
import { WaxError } from "../_shared/errors.ts";

serveAuthenticated(() => {
  throw new WaxError("not_implemented", "revoke-key is not implemented yet");
});
