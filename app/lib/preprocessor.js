var path = require('path'),
  _ = require('lodash')

var httpMethods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', '$ref'];

// Preprocessor for the Swagger JSON so that some of the logic can be taken
// out of the template.

module.exports = function(options, specData) {
  if (!options.specFile) {
    console.warn("[WARNING] preprocessor must be given 'options.specFile'.  Defaulting to 'cwd'.")
    options.specFile = process.cwd()
  }

  // Don't normalize x-spec-path to posix path. It must be a platoform specific.
  specData["x-spec-path"] = options.specFile;

  var copy = _.cloneDeep(specData)
  var tagsByName = _.keyBy(copy.tags, 'name')

  copy.tags = copy.tags || [];

  if (options.logoFile) {
    copy.logo = path.basename(options.logoFile)
  }

  // The "body"-parameter in each operation is stored in a
  // separate field "_request_body".
  if (copy.paths) {
    // Delete the /sentry path
    delete copy.paths["/sentry"];
    console.log(copy.paths);

    Object.keys(copy.paths).forEach(function(pathName) {
      var path = copy.paths[pathName]
      var pathParameters = path.parameters || []
      Object.keys(path).forEach(function(method) {
        if (httpMethods.indexOf(method) < 0) {
          delete path[method]
          return
        }
        var operation = path[method]
        operation.path = pathName
        operation.method = method
        // Draw links from tags to operations referencing them
        var operationTags = operation.tags || ['default']
        operationTags.forEach(function(tag) {
          if (!tagsByName[tag]) {
            // New implicit declaration of tag not defined in global "tags"-object
            // https://github.com/swagger-api/swagger-spec/blob/master/versions/2.0.md#user-content-swaggerTags
            var tagDefinition = {
              name: tag,
              operations: []
            }
            tagsByName[tag] = tagDefinition
            copy.tags.push(tagDefinition)
          }
          if (tagsByName[tag]) {
            tagsByName[tag].operations = tagsByName[tag].operations || []
            tagsByName[tag].operations.push(operation)
          }
        })
        // Join parameters with path-parameters
        operation.parameters = (operation.parameters || [])
          .concat(pathParameters)
          .filter(function(param) {
            if (param.in === 'body') {
              operation._request_body = param
              return false
            }
            return true
          })
        // Show body section, if either a body-parameter or a consumes-property is present.
        operation._show_requst_body_section = !!operation._request_body //|| operation.consumes
      })
    })
    // If there are multiple tags, we show the tag-based summary
    copy.showTagSummary = copy.tags.length > 1
  }

  var replaceRefs = require("./resolve-references").replaceRefs;
  replaceRefs(path.dirname(copy["x-spec-path"]), copy, copy, "")
  
  /* Drop the OPTIONS definitions because I really don't care about them for this documentation */
  for (let path in copy.paths) {
    delete copy.paths[path].options;
  }
  // Delete the Empty object as it's not necessary
  delete copy.definitions.Empty;
  // Delete the SNSMessage object as we don't want to publicise it
  delete copy.definitions.SNSMessage;
  
  /* Now we go through the special aws way of documenting, so that we can 
    insert description tags where they are meant to be. Because annoying AWS
  */
  for (let documentation_item of copy["x-amazon-apigateway-documentation"].documentationParts) {
    let target_item = documentation_item.location.name;
    let description = documentation_item.properties.description;
    
    switch (documentation_item.location.type) {
      case "API":
        // Insert the API description into the appropriate place
        copy.info.description = description;
        break;
      case "MODEL":
        let model = copy.definitions[target_item];
        if (model && description) {
            model.description = description;
        }
        break;
      case "RESPONSE":
        let response_path = copy.paths[documentation_item.location.path];
        if (!response_path) {
            break;
        }
        let response_method = response_path[documentation_item.location.method.toLowerCase()];
        if (!response_method) {
            break;
        }
        let response_status = response_method.responses[documentation_item.location.statusCode];
        if (response_status && description) {
            response_status.description = description;
        }
    }
  }
  return copy;
}

module.exports.httpMethods = httpMethods;
