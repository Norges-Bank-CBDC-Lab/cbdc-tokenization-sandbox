{{- define "config-toml-tpl" -}}
{{- tpl (.Files.Get "config/config.toml") . -}}
{{- end -}}