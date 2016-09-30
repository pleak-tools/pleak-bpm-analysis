# PLEAK - Privacy analysis tool version 1

This repository contains the source code of the privacy analysis tool developed
in the context of the Privacy Leakage Analysis Tools project.

The tool uses the [bpmn-js](https://github.com/bpmn-io/bpmn-js) viewer/editor
and is fully implemented in Javascript. Some parts of the code have been written
with the ES6 syntax such that it might fail to work with old browsers. It has
been test on recent versions of Chrome.

## Building the Project

The tool is implemented in Javascript. Development requires `node`, `npm` and
`grunt`. Before proceeding, check if you have installed the corresponding
software. The code has developed with `node` version 5.3.0 and `npm` version
3.3.12.

Once the requirements are meet, you can initialize the project dependencies via

```
npm install
```

The project contains a  [Grunt](http://gruntjs.com/) build script that defines a few tasks.

To create the sample distribution in the `dist` folder run

```
grunt
```

To bootstrap a development setup that spawns a small webserver and rebuilds your app on changes run

```
grunt auto-build
```

## Running the Tool

Once the tool has been built as described above, you can run the tool just by
opening the file `index.html` located at the `dist` folder. You can safely
distribute the files `index.html` and `app.js`, which will be enough to get the
tool working.

## License
