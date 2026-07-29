{{/* Chart name (overridable). */}}
{{- define "procela.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Fully-qualified release name. */}}
{{- define "procela.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "procela.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Common labels. */}}
{{- define "procela.labels" -}}
helm.sh/chart: {{ include "procela.chart" . }}
app.kubernetes.io/name: {{ include "procela.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{/* Selector labels for a given component (pass a dict: root . and "component"). */}}
{{- define "procela.selectorLabels" -}}
app.kubernetes.io/name: {{ include "procela.name" .root }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{/* Service account name. */}}
{{- define "procela.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "procela.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/* Registry prefix helper. */}}
{{- define "procela.image" -}}
{{- $repo := .repo -}}
{{- $tag := .tag -}}
{{- with .registry -}}{{- $repo = printf "%s%s" . $repo -}}{{- end -}}
{{- printf "%s:%s" $repo $tag -}}
{{- end -}}

{{/* Backend image ref. */}}
{{- define "procela.backendImage" -}}
{{- $tag := default .Chart.AppVersion .Values.backend.image.tag -}}
{{- include "procela.image" (dict "repo" .Values.backend.image.repository "tag" $tag "registry" .Values.imageRegistry) -}}
{{- end -}}

{{/* Frontend image ref. */}}
{{- define "procela.frontendImage" -}}
{{- $tag := default .Chart.AppVersion .Values.frontend.image.tag -}}
{{- include "procela.image" (dict "repo" .Values.frontend.image.repository "tag" $tag "registry" .Values.imageRegistry) -}}
{{- end -}}

{{/* Migration image ref — defaults to the backend image. */}}
{{- define "procela.migrationImage" -}}
{{- $repo := default .Values.backend.image.repository .Values.migrations.image.repository -}}
{{- $tag := default (default .Chart.AppVersion .Values.backend.image.tag) .Values.migrations.image.tag -}}
{{- include "procela.image" (dict "repo" $repo "tag" $tag "registry" .Values.imageRegistry) -}}
{{- end -}}

{{/* Name of the Secret the backend reads from. */}}
{{- define "procela.secretName" -}}
{{- if .Values.secrets.existingSecret -}}
{{- .Values.secrets.existingSecret -}}
{{- else -}}
{{- printf "%s-secrets" (include "procela.fullname" .) -}}
{{- end -}}
{{- end -}}

{{/* Computed DATABASE_URL (bundled Postgres or external). */}}
{{- define "procela.databaseUrl" -}}
{{- if .Values.postgresql.enabled -}}
{{- printf "postgresql://%s:%s@%s-postgresql:%v/%s?schema=public" .Values.postgresql.auth.username .Values.postgresql.auth.password (include "procela.fullname" .) .Values.postgresql.service.port .Values.postgresql.auth.database -}}
{{- else -}}
{{- required "externalDatabase.url is required when postgresql.enabled=false" .Values.externalDatabase.url -}}
{{- end -}}
{{- end -}}

{{/* Computed REDIS_URL (bundled Redis or external). */}}
{{- define "procela.redisUrl" -}}
{{- if .Values.redis.enabled -}}
{{- printf "redis://%s-redis:%v" (include "procela.fullname" .) .Values.redis.service.port -}}
{{- else -}}
{{- default "" .Values.externalRedis.url -}}
{{- end -}}
{{- end -}}
