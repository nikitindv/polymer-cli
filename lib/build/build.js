"use strict";
/**
 * @license
 * Copyright (c) 2016 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at
 * http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at
 * http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const logging = require("plylog");
const vinyl_fs_1 = require("vinyl-fs");
const mergeStream = require("merge-stream");
const polymer_build_1 = require("polymer-build");
const optimize_streams_1 = require("./optimize-streams");
const streams_1 = require("./streams");
const load_config_1 = require("./load-config");
const gulpFilter = require("gulp-filter");
const logger = logging.getLogger('cli.build.build');
exports.mainBuildDirectoryName = 'build';
const EXCLUDE_REGEX = [
    new RegExp(/\.map$/),
    new RegExp(/\/docs?\//),
    new RegExp(/\/demos?\//),
    new RegExp(/\/tests?\//),
    new RegExp(/\/examples?\//),
];
/**
 * Generate a single build based on the given `options` ProjectBuildOptions.
 * Note that this function is only concerned with that single build, and does
 * not care about the collection of builds defined on the config.
 */
function build(options, polymerProject) {
    return __awaiter(this, void 0, void 0, function* () {
        const buildName = options.name || 'default';
        const optimizeOptions = { css: options.css, js: options.js, html: options.html };
        const matcher = (file) => {
            const fileName = file.history.toString();
            for (let i = 0; i < EXCLUDE_REGEX.length; i++) {
                if (fileName.match(EXCLUDE_REGEX[i])) {
                    return false;
                }
            }
            return true;
        };
        // If no name is provided, write directly to the build/ directory.
        // If a build name is provided, write to that subdirectory.
        const buildDirectory = path.join(exports.mainBuildDirectoryName, buildName);
        logger.debug(`"${buildDirectory}": Building with options:`, options);
        // Fork the two streams to guarentee we are working with clean copies of each
        // file and not sharing object references with other builds.
        const sourcesStream = polymer_build_1.forkStream(polymerProject.sources().pipe(gulpFilter(matcher)));
        const depsStream = polymer_build_1.forkStream(polymerProject.dependencies().pipe(gulpFilter(matcher)));
        const htmlSplitter = new polymer_build_1.HtmlSplitter();
        let buildStream = streams_1.pipeStreams([
            mergeStream(sourcesStream, depsStream),
            htmlSplitter.split(),
            optimize_streams_1.getOptimizeStreams(optimizeOptions),
            htmlSplitter.rejoin()
        ]);
        const compiledToES5 = !!(optimizeOptions.js && optimizeOptions.js.compile);
        if (compiledToES5) {
            buildStream = buildStream.pipe(polymerProject.addBabelHelpersInEntrypoint());
            // already bundled within webcomponents-lite.js                      .pipe(polymerProject.addCustomElementsEs5Adapter());
        }
        const bundled = !!(options.bundle);
        if (bundled) {
            // Polymer 1.x and Polymer 2.x deal with relative urls in dom-module
            // templates differently.  Polymer CLI will attempt to provide a sensible
            // default value for the `rewriteUrlsInTemplates` option passed to
            // `polymer-bundler` based on the version of Polymer found in the project's
            // folders.  We will default to Polymer 1.x behavior unless 2.x is found.
            const bundlerOptions = {};
            if (typeof options.bundle === 'object') {
                Object.assign(bundlerOptions, options.bundle);
            }
            buildStream = buildStream.pipe(polymerProject.bundler(bundlerOptions));
        }
        if (options.insertPrefetchLinks) {
            buildStream = buildStream.pipe(polymerProject.addPrefetchLinks());
        }
        buildStream.once('data', () => {
            logger.info(`(${buildName}) Building...`);
        });
        if (options.basePath) {
            let basePath = options.basePath === true ? buildName : options.basePath;
            if (!basePath.startsWith('/')) {
                basePath = '/' + basePath;
            }
            if (!basePath.endsWith('/')) {
                basePath = basePath + '/';
            }
            buildStream = buildStream.pipe(polymerProject.updateBaseTag(basePath));
        }
        if (options.addPushManifest) {
            buildStream = buildStream.pipe(polymerProject.addPushManifest());
        }
        // Finish the build stream by piping it into the final build directory.
        buildStream = buildStream.pipe(vinyl_fs_1.dest(buildDirectory));
        // If a service worker was requested, parse the service worker config file
        // while the build is in progress. Loading the config file during the build
        // saves the user ~300ms vs. loading it afterwards.
        const swPrecacheConfigPath = path.resolve(polymerProject.config.root, options.swPrecacheConfig || 'sw-precache-config.js');
        let swConfig = null;
        if (options.addServiceWorker) {
            swConfig = yield load_config_1.loadServiceWorkerConfig(swPrecacheConfigPath);
        }
        // There is nothing left to do, so wait for the build stream to complete.
        yield streams_1.waitFor(buildStream);
        if (options.addServiceWorker) {
            logger.debug(`Generating service worker...`);
            if (swConfig) {
                logger.debug(`Service worker config found`, swConfig);
            }
            else {
                logger.debug(`No service worker configuration found at ` +
                    `${swPrecacheConfigPath}, continuing with defaults`);
            }
            yield polymer_build_1.addServiceWorker({
                buildRoot: buildDirectory,
                project: polymerProject,
                swPrecacheConfig: swConfig || undefined,
                bundled: bundled,
            });
        }
        logger.info(`(${buildName}) Build complete!`);
    });
}
exports.build = build;
