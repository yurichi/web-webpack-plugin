const fs = require('fs');
const url = require('url');
const path = require('path');
const CommonsChunkPlugin = require('webpack/lib/optimize/CommonsChunkPlugin');
const WebPlugin = require('./WebPlugin');
const util = require('./util');

/**
 * list only dir in dir
 * @param dir dir hold dir list
 * @param ignorePages page name list will not ignore by AutoWebPlugin(Not output html file for this page name)
 * @returns {Array}
 */
function getDirsInDir(dir, ignorePages = []) {
    const files = fs.readdirSync(dir);
    const ret = [];
    files.forEach(fileName => {
        if (
            ignorePages.findIndex(em => em === fileName) < 0 // not in ignorePages
            && fs.lstatSync(path.resolve(dir, fileName)).isDirectory() // is Directory
        ) {
            ret.push(fileName);
        }
    });
    return ret;
}

class AutoWebPlugin {

    /**
     *
     * @param pageDir the dir hold all pages
     * @param options
     * options.template {string,function}
     *      get WebPlugin template
     *      typeof===string: template config is html template file full path
     *      typeof===function: template config is function,ask user for detail
     *
     * options.entry {string,function,*}
     *      get page entryPath
     *      typeof===string: entry config is entry file full path
     *      typeof===function: entry config is function,ask user for detail
     *
     * options.filename {function,*}
     *      get WebPlugin output filename,default filename is pageName
     *      set options.filename as function(pageName)=>filename to add custom logic
     *
     * options.commonsChunk {Object}
     *      CommonsChunkPlugin options for all pages entry find by AutoWebPlugin.
     *      if this is null will not do commonsChunk action
     *      use CommonsChunkPlugin to handle with all pages's commons chunk. this will set CommonsChunkPlugin's chunks prop with all pages find by AutoWebPlugin.
     *
     * options.preEntrys {Array}
     *      entry files pre append to page entry for every page
     *
     * options.postEntrys {Array}
     *      entry files post append to page entry for every page
     *
     * options.stylePublicPath {string}
     *      publicPath for css file,for js file will use webpack.publicPath
     *
     * options.ignorePages {Array<string>}
     *      page name list will not ignore by AutoWebPlugin(Not output html file for this page name)
     *
     * options.outputPagemap {boolean}
     *      whether output a pagemap.json file which contain all pages has been resolved with AutoWebPlugin in this way:
     *      {
     *          "page name": "page url",
     *          ...
     *      }
     */
    constructor(pageDir, options) {
        options = Object.assign({}, options);
        this.options = options;
        const { template, entry, filename, ignorePages } = options;
        const pageNames = getDirsInDir(pageDir, ignorePages);
        const entryMap = {};
        // find out all page entry in pageDir,and get every page's html template path and js entryPath
        pageNames.forEach(pageName => {
            entryMap[pageName] = {}

            // get WebPlugin template
            if (typeof template === 'string') {
                // template config is html template file full path
                entryMap[pageName].template = template;
            } else if (typeof template === 'function') {
                // template config is function,ask user for detail
                entryMap[pageName].template = template(pageName)
            }

            // get page entryPath
            if (typeof entry === 'string' && entry.length > 0) {
                // entry config is entry file full path
                entryMap[pageName].entryPath = entry
            } else if (typeof entry === 'function') {
                // entry config is function,ask user for detail
                entryMap[pageName].entryPath = entry(pageName)
            } else {
                // use page dir's index.js or index.jsx as page entry
                entryMap[pageName].entryPath = path.resolve(pageDir, pageName, '')
            }

            // get WebPlugin output filename,default filename is pageName
            // set options.filename as function(pageName)=>filename to add custom logic
            if (typeof filename === 'function') {
                entryMap[pageName].filename = filename(pageName);
            } else {
                entryMap[pageName].filename = pageName;
            }
        });
        this.entryMap = entryMap;
    }

    // call by webpack
    apply(compiler) {
        global._isProduction = util.isProduction(compiler);
        global._isExtractStyle = util.isExtractStyle(compiler);
        const { options } = compiler;
        const { entryMap } = this;
        const { commonsChunk, preEntrys, postEntrys, stylePublicPath, outputPagemap } = this.options;

        //noinspection EqualityComparisonWithCoercionJS
        const useCommonsChunk = commonsChunk != null || typeof commonsChunk === 'object';

        Object.keys(entryMap).forEach(entryName => {
            const { template, entryPath } = entryMap[entryName];
            let pageEntryArray = [entryPath];
            if (Array.isArray(preEntrys)) {
                pageEntryArray = preEntrys.concat(pageEntryArray);
            }
            if (Array.isArray(postEntrys)) {
                pageEntryArray = pageEntryArray.concat(postEntrys);
            }
            // add entryMap from pages to webpack entry
            //noinspection JSUnresolvedVariable
            options.entry[entryName] = pageEntryArray;
            // add an WebPlugin for every page to output an html
            new WebPlugin({
                template: template,
                filename: `${entryName}.html`,
                requires: useCommonsChunk ? [commonsChunk.name, entryName] : [entryName],
                stylePublicPath
            }).apply(compiler);
        });

        if (useCommonsChunk) {
            const commonsChunkPluginOption = {
                // get all pages's commons chunk
                chunks: Object.keys(entryMap)
            };
            Object.assign(commonsChunkPluginOption, commonsChunk);
            //noinspection JSUnresolvedFunction
            new CommonsChunkPlugin(commonsChunkPluginOption).apply(compiler);
        }

        //noinspection JSUnresolvedFunction
        compiler.plugin('emit', (compilation, callback) => {
            if (outputPagemap) {
                //noinspection JSUnresolvedVariable
                const publicPath = util.getPublicPath(compilation);
                const outJson = {};
                Object.keys(this.entryMap).forEach(name => {
                    outJson[name] = url.resolve(publicPath, `${this.entryMap[name].filename}.html`)
                })
                util.addFileToWebpackOutput(compilation, 'pagemap.json', JSON.stringify(outJson));
            }
            callback();
        });
    }

}

module.exports = AutoWebPlugin;