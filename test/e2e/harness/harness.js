// Test-only page, copied into a temp build of the extension by the e2e runner.
// Exposes the real core modules to Runtime.evaluate. Never shipped.
import * as cookiesMod from '../src/core/cookies.js';
import * as io from '../src/core/io.js';
import * as model from '../src/core/model.js';
import * as site from '../src/core/site.js';
import * as validate from '../src/core/validate.js';

window.core = { ...cookiesMod, io, model, site, validate };
window.engine = cookiesMod.createEngine();
window.changes = 0;
window.engine.onChange(() => { window.changes++; });
window.events = [];
chrome.cookies.onChanged.addListener(({ removed, cause, cookie }) => window.events.push({ removed, cause, name: cookie.name }));
window.ready = true;
