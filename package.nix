{ stdenv
, lib
, drvSrc ? ./.
, mkNode
, nodejs-14_x
, makeWrapper
, ffmpeg
}:

let
  extraPath = [
    ffmpeg
  ];
in
mkNode {
  root = drvSrc;
  nodejs = nodejs-14_x;
  production = false;
  packageLock = ./package-lock.json;
} {
  buildInputs = extraPath;

  nativeBuildInputs = [
    makeWrapper
  ];

  preFixup = ''
    for bin in $out/bin/*; do
      wrapProgram $bin \
        --prefix PATH : ${lib.makeBinPath extraPath}
    done
  '';
}
