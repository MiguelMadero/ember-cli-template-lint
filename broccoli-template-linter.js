'use strict';

/* eslint-env node */

const Filter = require('broccoli-persistent-filter');
const md5Hex = require('md5-hex');
const stringify = require('json-stable-stringify');
const chalk = require('chalk');
const Linter = require('ember-template-lint');
const debug = require('debug')('template-lint:broccoli');
const projectLocalizationAddon = require('./lib/utils/project-localization-framework');
const testGenerators = require('aot-test-generators');
const testGeneratorNames = Object.keys(testGenerators);
const concat = require('broccoli-concat');

function TemplateLinter(inputNode, _options) {
  if (!(this instanceof TemplateLinter)) { return new TemplateLinter(inputNode, _options); }

  let options = _options || {};
  if (!options.hasOwnProperty('persist')) {
    options.persist = true;
  }

  Filter.call(this, inputNode, {
    annotation: options.annotation,
    persist: options.persist
  });


  this.options = options;
  this._console = this.options.console || console;
  this._templatercConfig = undefined;

  if (this.options.testGenerator) {
    let testGenerator = testGenerators[this.options.testGenerator];
    if (!testGenerator) {
      throw new Error(`No test generator found for "testGenerator: ${this.options.testGenerator}"`);
    }

    this._testGenerator = testGenerator;
  }

  this.linter = new Linter(options);

  debug('Linter config: %s', JSON.stringify(this.linter.config));

  this.issueLocalizationWarningIfNeeded();
}

TemplateLinter.prototype = Object.create(Filter.prototype);
TemplateLinter.prototype.constructor = TemplateLinter;

TemplateLinter.prototype.extensions = ['hbs'];
TemplateLinter.prototype.targetExtension = 'template.lint-test.js';

TemplateLinter.prototype.baseDir = function() {
  return __dirname;
};

TemplateLinter.prototype.cacheKeyProcessString = function(string, relativePath) {
  return md5Hex([
    stringify(this.linter.config),
    this.options.testGenerator || '',
    this.options.groupName || '',
    string,
    relativePath
  ]);
};

TemplateLinter.prototype.build = function () {
  let self = this;
  self._errors = [];

  return Filter.prototype.build.apply(this, arguments)
    .finally(function() {
      if (self._errors.length > 0) {
        let label = ' Template Linting Error' + (self._errors.length > 1 ? 's' : '');
        self._console.log('\n' + self._errors.join('\n'));
        self._console.log(chalk.yellow('===== ' + self._errors.length + label + '\n'));
      }
    });
};

TemplateLinter.prototype.convertErrorToDisplayMessage = function(error) {
  let message = error.rule + ': ' + error.message + ' (' + error.moduleId;

  if (error.line && error.column) {
    message = message + ' @ L' + error.line + ':C' + error.column;
  }

  message = message + ')';

  if (error.source) {
    message = message + ': \n`' + error.source + '`';
  }

  return message;
};

TemplateLinter.prototype.processString = function(contents, relativePath) {
  let errors = this.linter.verify({
    source: contents,
    moduleId: relativePath.slice(0, -4)
  });
  errors = errors.filter(function(error) {
    return error.severity > 1;
  });
  let passed = errors.length === 0;
  let errorDisplay = errors.map(function(error) {
    return this.convertErrorToDisplayMessage(error);
  }, this)
        .join('\n');

  let output = '';
  if (this._testGenerator) {
    if (this.options.groupName) {
      output = this._testGenerator.test(relativePath, passed,
        `${relativePath} should pass TemplateLint.\n\n${errorDisplay}`);

    } else {
      output = [
        this._testGenerator.suiteHeader(`TemplateLint | ${relativePath}`),
        this._testGenerator.test('should pass TemplateLint', passed,
          `${relativePath} should pass TemplateLint.\n\n${errorDisplay}`),
        this._testGenerator.suiteFooter()
      ].join('');
    }
  }

  debug('Found %s errors for %s with \ncontents: \n%s\nerrors: \n%s', errors.length, relativePath, contents, errorDisplay);

  return {
    errors: errors,
    output: output
  };
};

TemplateLinter.prototype.postProcess = function(results) {
  let errors = results.errors;

  for (let i = 0; i < errors.length; i++) {
    let errorDisplay = this.convertErrorToDisplayMessage(errors[i]);
    this._errors.push(chalk.red(errorDisplay));
  }

  return results;
};

TemplateLinter.prototype.issueLocalizationWarningIfNeeded = function() {
  if ('bare-strings' in this.linter.config.rules) {
    return;
  }

  let project = this.options.project;
  if (!project) {
    return;
  }

  let addon = projectLocalizationAddon(project);

  if (addon) {
    this._console.log(chalk.yellow(
      'The `bare-strings` rule must be configured when using a localization framework (`' + addon.name + '`). To prevent this warning, add the following to your `.template-lintrc.js`:\n\n  rules: {\n    \'bare-strings\': true\n  }'
    ));
  }
};

TemplateLinter.create = function(inputNode, options) {
  options = options || {};

  if (!options.groupName) {
    return new TemplateLinter(inputNode, options);
  }

  if (testGeneratorNames.indexOf(options.testGenerator) === -1) {
    throw new Error(`The "groupName" options can only be used with a "testGenerator" option of: ${testGeneratorNames}`);
  }

  let testGenerator = testGenerators[options.testGenerator];

  let headerName = 'TemplateLint';
  if (options.groupName !== 'templates') {
    headerName += ` | ${options.groupName}`;
  }

  let header = testGenerator.suiteHeader(headerName);
  let footer = testGenerator.suiteFooter();

  let lint = new TemplateLinter(inputNode, options);

  return concat(lint, {
    outputFile: `/${options.groupName}.template.lint-test.js`,
    header,
    inputFiles: ['**/*.template.lint-test.js'],
    footer,
    sourceMapConfig: { enabled: false },
    allowNone: true
  });
};

module.exports = TemplateLinter;
