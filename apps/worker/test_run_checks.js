"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var preReleaseSuite_1 = require("./src/checks/preReleaseSuite");
var playwright_1 = require("playwright");
function main() {
    return __awaiter(this, void 0, void 0, function () {
        var findings, browser, context, page, privacyFindings;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    console.log("Running checkFooterLogo...");
                    return [4 /*yield*/, (0, preReleaseSuite_1.checkFooterLogo)("https://elitederma.gogroth.com/", "test_run", "test_page")];
                case 1:
                    findings = _a.sent();
                    console.log("Findings from checkFooterLogo:", findings);
                    console.log("Running checkPrivacyPolicy...");
                    return [4 /*yield*/, playwright_1.chromium.launch({ headless: true })];
                case 2:
                    browser = _a.sent();
                    return [4 /*yield*/, browser.newContext()];
                case 3:
                    context = _a.sent();
                    return [4 /*yield*/, context.newPage()];
                case 4:
                    page = _a.sent();
                    return [4 /*yield*/, page.goto("https://elitederma.gogroth.com/", { waitUntil: "load", timeout: 60000 })];
                case 5:
                    _a.sent();
                    return [4 /*yield*/, (0, preReleaseSuite_1.checkPrivacyPolicy)(page, false)];
                case 6:
                    privacyFindings = _a.sent();
                    console.log("Findings from checkPrivacyPolicy:", privacyFindings);
                    return [4 /*yield*/, browser.close()];
                case 7:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
main().catch(console.error);
