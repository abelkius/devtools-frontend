// Copyright 2023 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as Common from '../../core/common/common.js';
import * as Host from '../../core/host/host.js';
import {assertNotNullOrUndefined} from '../../core/platform/platform.js';
import * as Coordinator from '../components/render_coordinator/render_coordinator.js';

import {getDomState, visibleOverlap} from './DomState.js';
import {type Loggable} from './Loggable.js';
import {debugString, getLoggingConfig} from './LoggingConfig.js';
import {logChange, logClick, logDrag, logHover, logImpressions, logKeyDown, logResize} from './LoggingEvents.js';
import {getLoggingState, getOrCreateLoggingState} from './LoggingState.js';
import {getNonDomState, unregisterAllLoggables, unregisterLoggable} from './NonDomState.js';

const PROCESS_DOM_INTERVAL = 500;
const KEYBOARD_LOG_INTERVAL = 3000;
const HOVER_LOG_INTERVAL = 1000;
const DRAG_LOG_INTERVAL = 500;
const CLICK_LOG_INTERVAL = 500;
const RESIZE_LOG_INTERVAL = 1000;
const RESIZE_REPORT_THRESHOLD = 50;

let processingThrottler: Common.Throttler.Throttler|null;
let keyboardLogThrottler: Common.Throttler.Throttler;
let hoverLogThrottler: Common.Throttler.Throttler;
let dragLogThrottler: Common.Throttler.Throttler;
let clickLogThrottler: Common.Throttler.Throttler;
let resizeLogThrottler: Common.Throttler.Throttler;

const mutationObservers = new WeakMap<Node, MutationObserver>();
const documents: Document[] = [];

function observeMutations(roots: Node[]): void {
  for (const root of roots) {
    if (!mutationObservers.has(root)) {
      const observer = new MutationObserver(scheduleProcessing);
      observer.observe(root, {attributes: true, childList: true, subtree: true});
      mutationObservers.set(root, observer);
    }
  }
}

let logging = false;

export function isLogging(): boolean {
  return logging;
}

export async function startLogging(options?: {
  processingThrottler?: Common.Throttler.Throttler,
  keyboardLogThrottler?: Common.Throttler.Throttler,
  hoverLogThrottler?: Common.Throttler.Throttler,
  dragLogThrottler?: Common.Throttler.Throttler,
  clickLogThrottler?: Common.Throttler.Throttler,
  resizeLogThrottler?: Common.Throttler.Throttler,
}): Promise<void> {
  logging = true;
  processingThrottler = options?.processingThrottler || new Common.Throttler.Throttler(PROCESS_DOM_INTERVAL);
  keyboardLogThrottler = options?.keyboardLogThrottler || new Common.Throttler.Throttler(KEYBOARD_LOG_INTERVAL);
  hoverLogThrottler = options?.hoverLogThrottler || new Common.Throttler.Throttler(HOVER_LOG_INTERVAL);
  dragLogThrottler = options?.dragLogThrottler || new Common.Throttler.Throttler(DRAG_LOG_INTERVAL);
  clickLogThrottler = options?.clickLogThrottler || new Common.Throttler.Throttler(CLICK_LOG_INTERVAL);
  resizeLogThrottler = options?.resizeLogThrottler || new Common.Throttler.Throttler(RESIZE_LOG_INTERVAL);
  await addDocument(document);
}

export async function addDocument(document: Document): Promise<void> {
  documents.push(document);
  if (['interactive', 'complete'].includes(document.readyState)) {
    await process();
  }
  document.addEventListener('visibilitychange', scheduleProcessing);
  document.addEventListener('scroll', scheduleProcessing);
  observeMutations([document.body]);
}

export function stopLogging(): void {
  logging = false;
  unregisterAllLoggables();
  for (const document of documents) {
    document.removeEventListener('visibilitychange', scheduleProcessing);
    document.removeEventListener('scroll', scheduleProcessing);
    mutationObservers.get(document.body)?.disconnect();
    mutationObservers.delete(document.body);
  }
  const {shadowRoots} = getDomState(documents);
  for (const shadowRoot of shadowRoots) {
    mutationObservers.get(shadowRoot)?.disconnect();
    mutationObservers.delete(shadowRoot);
  }
  documents.length = 0;
  processingThrottler = null;
}

export function scheduleProcessing(): void {
  if (!processingThrottler) {
    return;
  }
  void processingThrottler.schedule(
      () => Coordinator.RenderCoordinator.RenderCoordinator.instance().read('processForLogging', process));
}

let veDebuggingEnabled = false;
let debugPopover: HTMLElement|null = null;
const nonDomDebugElements = new WeakMap<Loggable, HTMLElement>();

function setVeDebuggingEnabled(enabled: boolean): void {
  veDebuggingEnabled = enabled;
  if (enabled && !debugPopover) {
    debugPopover = document.createElement('div');
    debugPopover.classList.add('ve-debug');
    debugPopover.style.position = 'absolute';
    debugPopover.style.bottom = '100px';
    debugPopover.style.left = '100px';
    debugPopover.style.background = 'black';
    debugPopover.style.color = 'white';
    debugPopover.style.zIndex = '100000';
    document.body.appendChild(debugPopover);
  }
}

// @ts-ignore
globalThis.setVeDebuggingEnabled = setVeDebuggingEnabled;

async function process(): Promise<void> {
  if (document.hidden) {
    return;
  }
  const startTime = performance.now();
  const {loggables, shadowRoots} = getDomState(documents);
  const visibleLoggables: Loggable[] = [];
  const viewportRects = new Map<Document, DOMRect>();
  observeMutations(shadowRoots);

  const viewportRectFor = (element: Element): DOMRect => {
    const ownerDocument = element.ownerDocument;
    const viewportRect = viewportRects.get(ownerDocument) ||
        new DOMRect(0, 0, ownerDocument.defaultView?.innerWidth || 0, ownerDocument.defaultView?.innerHeight || 0);
    viewportRects.set(ownerDocument, viewportRect);
    return viewportRect;
  };

  for (const {element, parent} of loggables) {
    const loggingState = getOrCreateLoggingState(element, getLoggingConfig(element), parent);
    if (!loggingState.impressionLogged) {
      const overlap = visibleOverlap(element, viewportRectFor(element));
      const visibleSelectOption = element.tagName === 'OPTION' && loggingState.parent?.selectOpen;
      if (overlap || visibleSelectOption) {
        if (overlap) {
          loggingState.size = overlap;
        }
        visibleLoggables.push(element);
        loggingState.impressionLogged = true;
      }
    }
    if (!loggingState.processed) {
      if (loggingState.config.track?.has('click')) {
        element.addEventListener('click', e => {
          const loggable = e.currentTarget as Element;
          void clickLogThrottler.schedule(async () => logClick(loggable, e));
        }, {capture: true});
      }
      if (loggingState.config.track?.has('dblclick')) {
        element.addEventListener('dblclick', e => {
          const loggable = e.currentTarget as Element;
          void clickLogThrottler.schedule(async () => logClick(loggable, e, {doubleClick: true}));
        }, {capture: true});
      }
      const trackHover = loggingState.config.track?.has('hover');
      if (trackHover) {
        element.addEventListener('mouseover', logHover(hoverLogThrottler), {capture: true});
        const cancelLogging = (): Promise<void> => Promise.resolve();
        element.addEventListener('mouseout', () => hoverLogThrottler.schedule(cancelLogging), {capture: true});
      }
      const trackDrag = loggingState.config.track?.has('drag');
      if (trackDrag) {
        element.addEventListener('pointerdown', logDrag(dragLogThrottler), {capture: true});
        const cancelLogging = (): Promise<void> => Promise.resolve();
        element.addEventListener('pointerup', () => dragLogThrottler.schedule(cancelLogging), {capture: true});
      }
      if (loggingState.config.track?.has('change')) {
        element.addEventListener('change', logChange, {capture: true});
      }
      const trackKeyDown = loggingState.config.track?.has('keydown');
      const codes = loggingState.config.track?.get('keydown')?.split(',') || [];
      if (trackKeyDown) {
        element.addEventListener('keydown', logKeyDown(codes, keyboardLogThrottler), {capture: true});
      }
      if (loggingState.config.track?.has('resize')) {
        const updateSize = (): void => {
          const overlap = visibleOverlap(element, viewportRectFor(element)) || new DOMRect(0, 0, 0, 0);
          if (!loggingState.size) {
            return;
          }
          if (Math.abs(overlap.width - loggingState.size.width) >= RESIZE_REPORT_THRESHOLD ||
              Math.abs(overlap.height - loggingState.size.height) >= RESIZE_REPORT_THRESHOLD) {
            void logResize(element, overlap, resizeLogThrottler);
          }
        };
        new ResizeObserver(updateSize).observe(element);
        new IntersectionObserver(updateSize).observe(element);
      }
      if (element.tagName === 'SELECT') {
        const onSelectOpen = (): void => {
          if (loggingState.selectOpen) {
            return;
          }
          loggingState.selectOpen = true;
          scheduleProcessing();
        };
        element.addEventListener('click', onSelectOpen, {capture: true});
        // Based on MenuListSelectType::ShouldOpenPopupForKey{Down,Press}Event
        element.addEventListener('keydown', event => {
          const e = event as KeyboardEvent;
          if ((Host.Platform.isMac() || e.altKey) && (e.code === 'ArrowDown' || e.code === 'ArrowUp') ||
              (!e.altKey && !e.ctrlKey && e.code === 'F4')) {
            onSelectOpen();
          }
        }, {capture: true});
        element.addEventListener('keypress', event => {
          const e = event as KeyboardEvent;
          if (e.key === ' ' || !Host.Platform.isMac() && e.key === '\r') {
            onSelectOpen();
          }
        }, {capture: true});
        element.addEventListener('change', e => {
          for (const option of (element as HTMLSelectElement).selectedOptions) {
            if (getLoggingState(option)?.config.track?.has('click')) {
              void logClick(option, e);
            }
          }
        }, {capture: true});
      }
      loggingState.processed = true;
    }
    if (veDebuggingEnabled && !loggingState.processedForDebugging) {
      if (element.tagName === 'OPTION') {
        if (loggingState.parent?.selectOpen && debugPopover) {
          debugPopover.innerHTML += '<br>' + debugString(loggingState.config);
          loggingState.processedForDebugging = true;
        }
      } else {
        (element as HTMLElement).style.outline = 'solid 1px red';
        element.addEventListener('mouseenter', () => {
          assertNotNullOrUndefined(debugPopover);
          debugPopover.style.display = 'block';
          const pathToRoot = [loggingState];
          let ancestor = loggingState.parent;
          while (ancestor) {
            pathToRoot.push(ancestor);
            ancestor = ancestor.parent;
          }
          debugPopover.innerHTML = pathToRoot.map(s => debugString(s.config)).join('<br>');
        }, {capture: true});
        element.addEventListener('mouseleave', () => {
          assertNotNullOrUndefined(debugPopover);
          debugPopover.style.display = 'none';
        }, {capture: true});
        loggingState.processedForDebugging = true;
      }
    }
  }
  for (const {loggable, config, parent} of getNonDomState().loggables) {
    const loggingState = getOrCreateLoggingState(loggable, config, parent);
    const visible = !loggingState.parent || loggingState.parent.impressionLogged;
    if (!visible) {
      continue;
    }
    if (veDebuggingEnabled) {
      let debugElement = nonDomDebugElements.get(loggable);
      if (!debugElement) {
        debugElement = document.createElement('div');
        debugElement.classList.add('ve-debug');
        debugElement.style.background = 'black';
        debugElement.style.color = 'white';
        debugElement.style.zIndex = '100000';
        debugElement.textContent = debugString(config);
        nonDomDebugElements.set(loggable, debugElement);
        setTimeout(() => {
          if (!loggingState.size?.width || !loggingState.size?.height) {
            debugElement?.parentElement?.removeChild(debugElement);
            nonDomDebugElements.delete(loggable);
          }
        }, 10000);
      }
      const parentDebugElement =
          parent instanceof HTMLElement ? parent : nonDomDebugElements.get(parent as Loggable) || debugPopover;
      assertNotNullOrUndefined(parentDebugElement);
      if (!parentDebugElement.classList.contains('ve-debug')) {
        debugElement.style.position = 'absolute';
        parentDebugElement.insertBefore(debugElement, parentDebugElement.firstChild);
      } else {
        debugElement.style.marginLeft = '10px';
        parentDebugElement.appendChild(debugElement);
      }
    }
    visibleLoggables.push(loggable);
    loggingState.impressionLogged = true;
    // No need to track loggable as soon as we've logged the impression
    // We can still log interaction events with a handle to a loggable
    unregisterLoggable(loggable);
  }
  await logImpressions(visibleLoggables);
  Host.userMetrics.visualLoggingProcessingDone(performance.now() - startTime);
}
