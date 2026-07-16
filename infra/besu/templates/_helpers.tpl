{{- define "validator-config-toml" -}}
{{- tpl (.Files.Get "config/validator.toml") . -}}
{{- end -}}

{{- define "archive-config-toml" -}}
{{- tpl (.Files.Get "config/archive.toml") . -}}
{{- end -}}
