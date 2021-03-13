const { buildSchema } = require('graphql');

const schema = buildSchema(`
type Query {
  hello: String
}
`);

module.exports = schema;
