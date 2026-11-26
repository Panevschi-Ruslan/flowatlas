import { lazy, type ComponentType } from 'react';

/** A screen loaded when first shown, handed back with a way to load it early. */
export function loadScreen<T extends ComponentType<unknown>>(factory: () => Promise<{ default: T }>) {
  const Component = lazy(factory);
  return { Component, preload: factory };
}
