/**
 * Copyright 2023 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
import * as Bidi from 'chromium-bidi/lib/cjs/protocol/protocol.js';
import { from, fromEvent, merge, map, forkJoin, first, firstValueFrom, raceWith, } from '../../third_party/rxjs/rxjs.js';
import { Frame, throwIfDetached, } from '../api/Frame.js';
import { UTILITY_WORLD_NAME, setPageContent, timeout } from '../common/util.js';
import { Deferred } from '../util/Deferred.js';
import { disposeSymbol } from '../util/disposable.js';
import { ExposeableFunction } from './ExposedFunction.js';
import { getBiDiLifecycleEvent, getBiDiReadinessState, rewriteNavigationError, } from './lifecycle.js';
import { MAIN_SANDBOX, PUPPETEER_SANDBOX, Sandbox, } from './Sandbox.js';
/**
 * Puppeteer's Frame class could be viewed as a BiDi BrowsingContext implementation
 * @internal
 */
let BidiFrame = (() => {
    let _classSuper = Frame;
    let _instanceExtraInitializers = [];
    let _goto_decorators;
    let _setContent_decorators;
    let _waitForNavigation_decorators;
    return class BidiFrame extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            __esDecorate(this, null, _goto_decorators, { kind: "method", name: "goto", static: false, private: false, access: { has: obj => "goto" in obj, get: obj => obj.goto }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _setContent_decorators, { kind: "method", name: "setContent", static: false, private: false, access: { has: obj => "setContent" in obj, get: obj => obj.setContent }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _waitForNavigation_decorators, { kind: "method", name: "waitForNavigation", static: false, private: false, access: { has: obj => "waitForNavigation" in obj, get: obj => obj.waitForNavigation }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        #page = (__runInitializers(this, _instanceExtraInitializers), void 0);
        #context;
        #timeoutSettings;
        #abortDeferred = Deferred.create();
        #disposed = false;
        sandboxes;
        _id;
        constructor(page, context, timeoutSettings, parentId) {
            super();
            this.#page = page;
            this.#context = context;
            this.#timeoutSettings = timeoutSettings;
            this._id = this.#context.id;
            this._parentId = parentId ?? undefined;
            this.sandboxes = {
                [MAIN_SANDBOX]: new Sandbox(undefined, this, context, timeoutSettings),
                [PUPPETEER_SANDBOX]: new Sandbox(UTILITY_WORLD_NAME, this, context.createRealmForSandbox(), timeoutSettings),
            };
        }
        get client() {
            return this.context().cdpSession;
        }
        mainRealm() {
            return this.sandboxes[MAIN_SANDBOX];
        }
        isolatedRealm() {
            return this.sandboxes[PUPPETEER_SANDBOX];
        }
        page() {
            return this.#page;
        }
        url() {
            return this.#context.url;
        }
        parentFrame() {
            return this.#page.frame(this._parentId ?? '');
        }
        childFrames() {
            return this.#page.childFrames(this.#context.id);
        }
        async goto(url, options = {}) {
            const { waitUntil = 'load', timeout: ms = this.#timeoutSettings.navigationTimeout(), } = options;
            const [readiness, networkIdle] = getBiDiReadinessState(waitUntil);
            const response = await firstValueFrom(this.#page
                ._waitWithNetworkIdle(this.#context.connection.send('browsingContext.navigate', {
                context: this.#context.id,
                url,
                wait: readiness,
            }), networkIdle)
                .pipe(raceWith(timeout(ms), from(this.#abortDeferred.valueOrThrow())))
                .pipe(rewriteNavigationError(url, ms)));
            return this.#page.getNavigationResponse(response?.result.navigation);
        }
        async setContent(html, options = {}) {
            const { waitUntil = 'load', timeout: ms = this.#timeoutSettings.navigationTimeout(), } = options;
            const [waitEvent, networkIdle] = getBiDiLifecycleEvent(waitUntil);
            await firstValueFrom(this.#page
                ._waitWithNetworkIdle(forkJoin([
                fromEvent(this.#context, waitEvent).pipe(first()),
                from(setPageContent(this, html)),
            ]).pipe(map(() => {
                return null;
            })), networkIdle)
                .pipe(raceWith(timeout(ms), from(this.#abortDeferred.valueOrThrow())))
                .pipe(rewriteNavigationError('setContent', ms)));
        }
        context() {
            return this.#context;
        }
        async waitForNavigation(options = {}) {
            const { waitUntil = 'load', timeout: ms = this.#timeoutSettings.navigationTimeout(), } = options;
            const [waitUntilEvent, networkIdle] = getBiDiLifecycleEvent(waitUntil);
            const navigatedObservable = merge(forkJoin([
                fromEvent(this.#context, Bidi.ChromiumBidi.BrowsingContext.EventNames.NavigationStarted).pipe(first()),
                fromEvent(this.#context, waitUntilEvent).pipe(first()),
            ]), fromEvent(this.#context, Bidi.ChromiumBidi.BrowsingContext.EventNames.FragmentNavigated)).pipe(map(result => {
                if (Array.isArray(result)) {
                    return { result: result[1] };
                }
                return { result };
            }));
            const response = await firstValueFrom(this.#page
                ._waitWithNetworkIdle(navigatedObservable, networkIdle)
                .pipe(raceWith(timeout(ms), from(this.#abortDeferred.valueOrThrow()))));
            return this.#page.getNavigationResponse(response?.result.navigation);
        }
        get detached() {
            return this.#disposed;
        }
        [(_goto_decorators = [throwIfDetached], _setContent_decorators = [throwIfDetached], _waitForNavigation_decorators = [throwIfDetached], disposeSymbol)]() {
            if (this.#disposed) {
                return;
            }
            this.#disposed = true;
            this.#abortDeferred.reject(new Error('Frame detached'));
            this.#context.dispose();
            this.sandboxes[MAIN_SANDBOX][disposeSymbol]();
            this.sandboxes[PUPPETEER_SANDBOX][disposeSymbol]();
        }
        #exposedFunctions = new Map();
        async exposeFunction(name, apply) {
            if (this.#exposedFunctions.has(name)) {
                throw new Error(`Failed to add page binding with name ${name}: globalThis['${name}'] already exists!`);
            }
            const exposeable = new ExposeableFunction(this, name, apply);
            this.#exposedFunctions.set(name, exposeable);
            try {
                await exposeable.expose();
            }
            catch (error) {
                this.#exposedFunctions.delete(name);
                throw error;
            }
        }
    };
})();
export { BidiFrame };
//# sourceMappingURL=Frame.js.map