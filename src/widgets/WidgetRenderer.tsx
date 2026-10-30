// Widget renderer/host (polish/3-widget-core): resolves an instance
// against the type registry and renders it. Host-agnostic on purpose —
// no rail sizing, ordering, persistence, or visibility logic lives here.
// The rail and the future deck UI share this component without importing
// each other.

import {t} from '@lingui/macro'

import {Body} from '#/alf/typography'

import {getWidgetDefinition} from './registry'
import {WidgetFrame} from './placeholder'
import type {WidgetInstance} from './model'

/** Fallback for instances whose type is not in the registry (a config
 * written by a newer client, or a removed type). An honest empty card —
 * never hidden silently, never fabricated content. */
export function UnknownWidgetFallback({instance}: {instance: WidgetInstance}) {
  return (
    <WidgetFrame instanceId={instance.id} title={t`Widget`}>
      <UnknownWidgetBody />
    </WidgetFrame>
  )
}

function UnknownWidgetBody() {
  return <Body color="muted">{t`This widget is unavailable.`}</Body>
}

export function WidgetRenderer({instance}: {instance: WidgetInstance}) {
  const definition = getWidgetDefinition(instance.type)
  if (!definition) return <UnknownWidgetFallback instance={instance} />
  const {Component} = definition
  return <Component instance={instance} />
}
