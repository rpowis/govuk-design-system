'use strict'

const paths = require('../config/paths.json')

const fs = require('fs')
const path = require('path')
const nunjucks = require('nunjucks')
const matter = require('gray-matter')

const beautify = require('js-beautify').html

const markdownRenderer = require('marked')

nunjucks.configure(paths.layouts)

// This helper function takes a path of a file and
// returns the contents as string
exports.getFileContents = path => {
  let fileContents
  try {
    fileContents = fs.readFileSync(path)
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log(err.message)
    } else {
      throw err
    }
  }
  return fileContents.toString()
}

// This helper function takes a path of a *.md.njk file and
// returns the Nunjucks syntax inside that file without markdown data and imports
exports.getNunjucksCode = path => {
  let fileContents = this.getFileContents(path)

  let parsedFile = matter(fileContents)

  // Omit any `{% extends "foo.njk" %}` nunjucks code, because we extend
  // templates that only exist within the Design System – it's not useful to
  // include this in the code we expect others to copy.
  let content = parsedFile.content.replace(
    /{%\s*extends\s*\S*\s*%}\s+/,
    ''
  )

  return content
}

// This helper function takes a path of a macro options file and
// returns the options data grouped by tables to output in markup
exports.getMacroOptions = (componentName, exampleId) => {
  let options = []
  let processedOptions = []
  let primaryTable = {
    'name': 'Primary options',
    'id': 'primary',
    'options': []
  }
  processedOptions.push(primaryTable)

  if (componentName === 'text-input') {
    componentName = 'input'
  }

  try {
    let optionsFilePath = path.join(paths.govukfrontendcomponents, componentName, 'macro-options.json')
    options = JSON.parse(fs.readFileSync(optionsFilePath, 'utf8'))
  } catch (err) {
    console.error(err)
    process.exit(1) // Exit with a failure mode
  }

  for (let option of options) {
    // Example of an option
    // {
    //    name: "errorMessage",
    //    type: "string",
    //    required: false,
    //    description: "Options for the errorMessage component"
    //    isComponent: true
    // }
    if (option.isComponent) {
      // Create separate table data for components that are hidden in the
      // Design System
      if (option.name === 'hint' || option.name === 'label') {
        let otherComponentOptions
        try {
          let otherComponentPath = path.join(paths.govukfrontendcomponents, option.name, 'macro-options.json')
          otherComponentOptions = JSON.parse(fs.readFileSync(otherComponentPath, 'utf8'))
        } catch (err) {
          console.error(err)
          process.exit(1) // Exit with a failure mode
        }

        if (otherComponentOptions) {
          processedOptions.push({
            'name': 'Options for ' + option.name,
            'id': option.name,
            'options': otherComponentOptions
          })
          option.description += ` See [${option.name}](#options-${exampleId}--${option.name}).`
        }
      // Otherwise just link to that component
      } else {
        let optionName = (option.name).replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase() // camelCase into kebab-case
        let otherComponentPath = '/components/' + optionName + '/#options-example-default'
        option.description += ` See [${option.name}](${otherComponentPath}).`
      }
    }

    // If option contains nested options, add those as a separate table and link to it
    if (option.params) {
      processedOptions.push({
        'name': 'Options for ' + option.name,
        'id': option.name,
        'options': option.params
      })
      option.description += ` See [${option.name}](#options-${exampleId}--${option.name}).`
    }

    if (option.required === true) {
      option.description = '__Required__. ' + option.description
    }

    primaryTable.options.push(option)
  }

  // Get reference to marked.js
  let renderer = new markdownRenderer.Renderer()
  // Override marking up paragraphs
  renderer.paragraph = text => text

  // This will recursively loop through the options data and call itself when
  // encountering a nested item. Any 'description' fields are marked up using
  // marked.js
  let markUpDescriptions = (options) => {
    for (var key in options) {
      if (options.hasOwnProperty(key)) {
        if (typeof options[key] === 'object') {
          markUpDescriptions(options[key])
        } else if (key === 'description') {
          try {
            options[key] = markdownRenderer(options[key], { renderer: (renderer) })
          } catch (e) {
            console.error(e)
            process.exit(1) // Exit with a failure mode
          }
        }
      }
    }
    return options
  }

  // Mark up 'description' values in options
  let markedUpOptions = processedOptions.map(markUpDescriptions)

  return markedUpOptions
}

// This helper function takes a path of a *.md.njk file and
// returns the frontmatter as an object
exports.getFrontmatter = path => {
  let fileContents = this.getFileContents(path)

  let parsedFile = matter(fileContents)
  return parsedFile.data
}

// Get 'fingerprinted' version of a given asset file.
exports.getFingerprint = function (file) {
  // Grab fingerprint array from the template context
  const filePath = this.lookup('path')
  const fingerprints = this.lookup('fingerprint')

  // If that fails, and we know the path of the current file, look for a
  // fingerprinted asset relative to the current file (e.g. `../foo.css`)
  //
  // We only know the path of the current file when we're compiling the layout –
  // calls to this function with a relative path will fail if made from the
  // source files themselves.
  if (filePath) {
    const relativeFile = path.join(filePath, file)

    if (fingerprints.hasOwnProperty(relativeFile)) {
      return '/' + fingerprints[relativeFile]
    }
  }

  // Look for a fingerprinted asset at this path relative to the site root
  if (fingerprints.hasOwnProperty(file)) {
    return '/' + fingerprints[file]
  }

  // The thrown error will stop the build, but not provide any useful output,
  // so we have to console.log as well.
  console.log(`Could not find fingerprint for file ${file}`)
  throw new Error(`Could not find fingerprint for file ${file}`)
}

// This helper function takes a path of a *.md.njk file and
// returns the HTML rendered by Nunjucks without markdown data
exports.getHTMLCode = path => {
  let fileContents = this.getFileContents(path)

  let parsedFile = matter(fileContents)
  let content = parsedFile.content

  let html
  try {
    html = nunjucks.renderString(content)
  } catch (err) {
    if (err) {
      console.log('Could not get HTML code from ' + path)
    }
  }

  return beautify(html.trim(), {
    indent_size: 2,
    end_with_newline: true,
    // If there are multiple blank lines, reduce down to one blank new line.
    max_preserve_newlines: 1,
    // set unformatted to a small group of elements, not all inline (the default)
    // otherwise tags like label arent indented properly
    unformatted: ['code', 'pre', 'em', 'strong']
  })
}

// This helper function takes a path and
// returns the directories found under that path
exports.getDirectories = itemPath => {
  let files
  let directories
  try {
    files = fs.readdirSync(itemPath)
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log(err.message)
    } else {
      throw err
    }
  }
  if (files) {
    directories = files.filter(filePath => fs.statSync(path.join(itemPath, filePath)).isDirectory())
  }
  return directories
}
