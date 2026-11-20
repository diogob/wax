{
  description = "Wax: OpenPGP keys, proofs and signed messages on GitHub Pages + Supabase";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      systems = [
        "aarch64-darwin"
        "x86_64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];
      forAll = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      devShells = forAll (pkgs: {
        default = pkgs.mkShell {
          packages =
            with pkgs;
            [
              deno
              supabase-cli
              gnupg
              jq
              postgresql_17 # psql client
            ]
            # Supabase CLI needs a Docker daemon; colima provides one on macOS.
            ++ lib.optionals stdenv.hostPlatform.isDarwin [
              colima
              docker-client
            ];
        };
      });
    };
}
