module.exports = function(grunt) {

  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),
    browserify: {
      dist: {
        files: {
          'build/openctm-async.js': [ 'src/openctm-async.js' ],
          'demo/openctm-async.js': [ 'src/openctm-async.js' ]
        },
        options: {
          browserifyOptions: {
            standalone: 'CTMAsync'
          }
        }
      }
    }
  });

  grunt.loadNpmTasks('grunt-browserify');

  grunt.registerTask('default', ['browserify']);

};