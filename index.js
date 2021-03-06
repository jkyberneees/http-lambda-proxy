const AWS = require('aws-sdk')
const URL = require('fast-url-parser')

const invocationType = 'RequestResponse'

module.exports = ({
  target, // the name of the Lambda function, version, or alias.
  logType = 'None', // set to "Tail" to include the execution log in the response
  qualifier = null, // specify a version or alias to invoke a published version of the function
  clientContext = null, // up to 3583 bytes of base64-encoded data about the invoking client to pass to the function in the context object
  lambdaProxy, // AWS lambda invocation proxy
  ...lambdaProxyArgs
}) => {
  lambdaProxy = lambdaProxy || getLambdaProxy(lambdaProxyArgs)

  return (req, res, url, opts) => {
    const onResponse = opts.onResponse
    const rewriteHeaders = opts.rewriteHeaders || headersNoOp

    const shouldParseQueryString = typeof (req.query) !== 'object'
    const { _query, pathname } = URL.parse(url, shouldParseQueryString)

    const params = {
      ClientContext: clientContext,
      FunctionName: target,
      LogType: logType,
      InvocationType: invocationType,
      Qualifier: qualifier,
      Payload: JSON.stringify({
        headers: req.headers,
        body: req.body,
        httpMethod: req.method,
        path: pathname,
        isBase64Encoded: false,
        queryStringParameters: shouldParseQueryString ? _query : req.query
      })
    }

    lambdaProxy(params, (err, response) => {
      if (err) {
        if (err.message.startsWith('Function not found:')) {
          err.statusCode = 503
        }
        res.statusCode = err.statusCode
        res.end(err.message)
      } else if (response.FunctionError === 'Unhandled') {
        // https://docs.aws.amazon.com/lambda/latest/dg/nodejs-exceptions.html
        const { errorType, errorMessage } = JSON.parse(response.Payload)
        res.statusCode = 500
        res.end(`${errorType}:${errorMessage}`)
      } else {
        let jsonPayload
        try {
          jsonPayload = JSON.parse(response.Payload)
        } catch (err) {
          res.statusCode = 500
          res.end('Lambda not responded using JSON format!')

          return
        }

        const { headers, statusCode = response.StatusCode, body } = jsonPayload
        if (headers) {
          copyHeaders(
            rewriteHeaders(headers),
            res
          )
        }

        if (onResponse) {
          onResponse(req, res, response)
        } else {
          res.statusCode = statusCode
          res.end(body)
        }
      }
    })
  }
}

function copyHeaders (headers, res) {
  const headersKeys = Object.keys(headers)

  let header
  let i
  for (i = 0; i < headersKeys.length; i++) {
    header = headersKeys[i]
    if (header.charCodeAt(0) !== 58) { // fast path for indexOf(':') === 0
      res.setHeader(header, headers[header])
    }
  }
}

function headersNoOp (headers) {
  return headers
}

function getLambdaProxy (config) {
  const lambda = new AWS.Lambda(config)

  return (params, cb) => lambda.invoke(params, cb)
}
