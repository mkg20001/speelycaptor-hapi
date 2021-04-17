{ config, lib, pkgs, ... }:

with lib;

let
  cfg = config.services.speelycaptor;
  speelycaptor = pkgs.speelycaptor;
in
{
  options = {
    services.speelycaptor = {
      enable = mkEnableOption "Speelycaptor server";

      port = mkOption {
        description = "Port to listen at";
        type = types.int;
        default = 34221;
      };

      tmpFolder = mkOption {
        description = "Alternative folder to use for temporary storage";
        type = types.nullOr types.path;
        default = null;
      };

      externalUrl = mkOption {
        description = "External URL to use for submissions";
        type = types.str;
        default = "http://localhost:34221";
      };

      openFirewall = mkOption {
        type = types.bool;
        default = false;
        description = "Open ports in the firewall for TeamSpeak DNS.";
      };
    };
  };

  config = mkIf (cfg.enable) {
    networking.firewall = mkIf cfg.openFirewall {
      allowedTCPPorts = [ cfg.port ];
    };

    systemd.services.speelycaptor = with pkgs; {
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];
      requires = [ "network-online.target" ];

      description = "Speelycaptor server";

      Environment.CONFIG = toFile "config.json" (toJSON {
        hapi.port = cfg.port;
        externalUrl = cfg.externalUrl;
        tmpFolder = if cfg.tmpFolder != null then cfg.tmpFolder else null;
      });

      serviceConfig = {
        Type = "simple";
        DynamicUser = true;
        ReadWritePaths = if cfg.tmpFolder != null then cfg.tmpFolder else "";
        ExecStart = "${speelycaptor}/bin/speelycaptor";
      };
    };
  };
}
