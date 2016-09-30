'use strict';

var fs = require('fs');
var sprintf = require("sprintf-js").sprintf;

document.flattenMatrix = {};

var BpmnViewer = require('bpmn-js');

var bpmnViewer = new BpmnViewer({
  container: '#canvas'
});

var container = document.getElementById('js-drop-zone');

var shortenDataObjectName = function (name) {
    var matched = name.match(/\(([^\)]+)\)/);
    if (matched) name = matched[1];
    return name;
}

var topologicalSorting = function (adjList, invAdjList, sources) {
    var order = new Array();

    var sourcesp = sources.slice();
    var invAdjListp = new Map();
    for (var [key, value] of invAdjList)
        invAdjListp.set(key, value.slice());
    while (sourcesp.length > 0) {
        var n = sourcesp.pop();
        order.push(n);
        if (adjList.get(n))
            for (var _m in adjList.get(n)) {
                var m = adjList.get(n)[_m];
                invAdjListp.get(m).splice(invAdjListp.get(m).indexOf(n), 1);
                if (invAdjListp.get(m).length == 0) {
                    sourcesp.push(m);
                }
            }
    }

    return order;
}

var analyzeDPOnProcessDef = function (procDef, inputDataObject, outputDataObject, elementRegistry) {
    var adjList = new Map();
    var invAdjList = new Map();
    var targets = new Array();
    var targetTask = null;

    for (var _flowElement in procDef.flowElements) {
        var flowElement = procDef.flowElements[_flowElement];
        if (flowElement.dataInputAssociations) {
            for (var _sourceAssociation in flowElement.dataInputAssociations) {
                var sourceAssociation = flowElement.dataInputAssociations[_sourceAssociation];
                var sourceNode = sourceAssociation.sourceRef[0];
                adjList.set(sourceNode, (adjList.get(sourceNode) || []).concat(flowElement));
                invAdjList.set(flowElement, (invAdjList.get(flowElement) || []).concat(sourceNode));
                targets.push(flowElement);
            }
        }
        if (flowElement.dataOutputAssociations) {
            for (var _targetAssociation in flowElement.dataOutputAssociations) {
                var targetAssociation = flowElement.dataOutputAssociations[_targetAssociation];
                var targetNode = targetAssociation.targetRef;
                if (targetNode.id == outputDataObject.id)
                  targetTask = flowElement;
                adjList.set(flowElement, (adjList.get(flowElement) || []).concat(targetNode));
                invAdjList.set(targetNode, (invAdjList.get(targetNode) || []).concat(flowElement));
                targets.push(targetNode);
            }
        }
    }

    var sources = new Array();
    var sinks = new Array();

    for (var node of adjList.keys()) if (targets.indexOf(node) < 0) sources.push(node);
    for (var node of targets) if (!adjList.has(node)) sinks.push(node);

    var topOrder = topologicalSorting(adjList, invAdjList, sources);

    var coverage = [];
    var _dfs = function (curr) {
        coverage.push(curr);
        if (adjList.get(curr))
            for (let succ of adjList.get(curr))
                if (coverage.indexOf(succ) == -1)
                    _dfs(succ);
    };
    _dfs(inputDataObject.businessObject);

    var order = [];

    topOrder.forEach(function (elem) { if (coverage.indexOf(elem) >= 0) order.push(elem); });

    var copyOfFlattenMatrix = {};

    for (var key in document.flattenMatrix) {
      var nameMap = {};
      key.split(/[\,\;]/).forEach(function (dataObjectId) {
          if (elementRegistry.get(dataObjectId)) // <<<<< CHECK THIS !!!!
              nameMap[dataObjectId] = shortenDataObjectName(elementRegistry.get(dataObjectId).businessObject.name);
      });
      var nkey = key;
      for (var dataObjectId in nameMap)
        nkey = nkey.replace(new RegExp(dataObjectId, 'g'), nameMap[dataObjectId]);
      nkey = nkey.replace(/,/g, '_');
      copyOfFlattenMatrix[nkey] = document.flattenMatrix[key].replace(/([a-lx-z_][a-zA-Z0-9_]*)/g, 'this.$1');
    }

    var dataObjects = [], dataObjectsMap = {}, context = {}, outputDataObjectIndex = -1;
    var componentTasks = [];
    context["functionEval"] = function (str) { return eval(str); };

    for (var node of order) {
      if (node.$type == 'bpmn:Task') {
        // Note that we filter out all the data source nodes
        var localPredecessors = invAdjList.get(node).filter(function (n) { return sources.indexOf(n) == -1; });
        if (localPredecessors.length > 1) {
          var ncomp =(function traverse(curr) {
            var components = [];
            for (var flowEdge of curr.incoming) {
              var pred = flowEdge.sourceRef;
              if (pred.$type == "bpmn:ExclusiveGateway") {
                var nested = traverse(pred);
                var nestedLabel = nested.join().split(',').sort().toString().replace(/,/g,'_');

                dataObjectsMap[nestedLabel] = dataObjects.length;
                context[nestedLabel] = dataObjects.length;
                dataObjects.push(nestedLabel);
                components.push(nested);
                componentTasks.push({node: pred, cmp: nested});
              } else if (pred.$type == "bpmn:ParallelGateway") {
                var nested = traverse(pred);
                var nestedLabel = nested.join().split(',').sort().toString().replace(/,/g,'_');

                dataObjectsMap[nestedLabel] = dataObjects.length;
                context[nestedLabel] = dataObjects.length;
                dataObjects.push(nestedLabel);
                components.push(nested);
                componentTasks.push({node: pred, cmp: nested});
              } else if (pred.$type == "bpmn:Task") {
                for (var dobj of adjList.get(pred))
                  if (invAdjList.get(node).indexOf(dobj) >= 0)
                    components.push([shortenDataObjectName(dobj.name)]); /// <<<<===== HERE: What if we have multiple dataObjects connecting 'pred' and 'node'?
              }
            }

            return components;
          }(node));
        }

        componentTasks.push({node: node});
        if (node.id == targetTask.id) {
            var shortenName = shortenDataObjectName(outputDataObject.businessObject.name);
          dataObjectsMap[shortenName] = dataObjects.length;
          context[shortenName] = dataObjects.length;
          outputDataObjectIndex = dataObjects.length;
          dataObjects.push(shortenName);
          break;
        }
      } else if (node.$type == 'bpmn:DataObjectReference') {
          var shortenName = shortenDataObjectName(node.name);
          dataObjectsMap[shortenName] = dataObjects.length;
        context[shortenName] = dataObjects.length;
        dataObjects.push(shortenName);
      }
    }

    var computation = function (daap) {
      context['_d'] = new Array(dataObjects.length);
      for (var i = 0; i < dataObjects.length; i++) {
        context['_d'][i] = new Array(dataObjects.length);
        for (var j = 0; j < dataObjects.length; j++)
          context['_d'][i][j] = Infinity;
      }
      context['_d'][0][0] = daap;

      var maxIndex = -1, lastMaxIndex = -1;

      for (var taskIdx in componentTasks) {
        var cmp = componentTasks[taskIdx];
        if (cmp.node.$type == 'bpmn:Task') {
          var task = cmp.node;
          var preds = invAdjList.get(task).filter(function (element) { return order.indexOf(element) != -1;});
          var succs = adjList.get(task);
          var names = [];
          for (var i in preds)
              names.push(shortenDataObjectName(preds[i].name));
          names.sort();
          var src = dataObjectsMap[names.sort().toString().replace(/,/g,'_')];
          for (var succ in succs) {
            var tgt = dataObjectsMap[shortenDataObjectName(succs[succ].name)];
            if (!tgt || tgt >= dataObjects.length) break;
            maxIndex = tgt > maxIndex ? tgt : maxIndex;
            var expr = copyOfFlattenMatrix[names.sort().toString().replace(/,/g,'_')+";"+shortenDataObjectName(succs[succ].name)];
            if (expr != null)
              context['_d'][src][tgt] = context['_d'][tgt][src] = context.functionEval(expr) || Infinity;
            for (var succ2 in succs) {
              var src2 = dataObjectsMap[shortenDataObjectName(succs[succ2].name)];
              if (!src2 || src2 >= dataObjects.length) break;
              var expr2 = copyOfFlattenMatrix[shortenDataObjectName(succs[succ2].name)+";"+shortenDataObjectName(succs[succ].name)];
              if (expr2 != null)
                context['_d'][src2][tgt] = context['_d'][tgt][src2] = context.functionEval(expr2) || Infinity;
            }
          }

        } else if (cmp.node.$type == 'bpmn:ExclusiveGateway') {
          var cmpPreds = cmp.cmp;
          var succLabel = cmpPreds.join().split(',').sort().toString().replace(/,/g,'_');

          var gdistances = [];
          for (var predCmpIdx in cmp.cmp) {
            var predCmp = cmp.cmp[predCmpIdx];
            var distances = [];
            var predCmpLabel = predCmp.join().split(',').sort().toString().replace(/,/g,'_');
            var src = dataObjectsMap[predCmpLabel];
            for (var succCmpIdx in cmp.cmp) {
              var succCmp = cmp.cmp[succCmpIdx];
              var succCmpLabel = succCmp.join().split(',').sort().toString().replace(/,/g,'_');
              var tgt = dataObjectsMap[succCmpLabel];
              maxIndex = tgt > maxIndex ? tgt : maxIndex;
              var dist = context['_d'][src][tgt];
              if (dist != Infinity)
                distances.push(dist);
              if (succCmpIdx > predCmpIdx && dist != Infinity)
                gdistances.push(dist);
            }
            context['_d'][src][dataObjectsMap[succLabel]] = Math.max.apply(null, distances);
            gdistances.push(context['_d'][src][src]);
          }
          context['_d'][dataObjectsMap[succLabel]][dataObjectsMap[succLabel]] = Math.max.apply(null, gdistances);
        } else if (cmp.node.$type == 'bpmn:ParallelGateway') {
          continue;
        }
        maxIndex = maxIndex > lastMaxIndex ? maxIndex : lastMaxIndex;
        lastMaxIndex = maxIndex;
          var matrixSize = (maxIndex + 1) * 2;
          var dist = new Array(matrixSize);
          for (var i = 0; i < matrixSize; i++) {
            dist[i] = new Array(matrixSize);
            for (var j = 0; j < matrixSize; j++)
              dist[i][j] = i == j ? 0 : Infinity;
          }
          for (var i = 0; i <= maxIndex; i++)
            for (var j = 0; j <= maxIndex; j++)
              dist[i][j+maxIndex+1] = dist[i+maxIndex+1][j] = context._d[i][j];

          for (var k = 0; k < matrixSize; k++)
            for (var i = 0; i < matrixSize; i++)
              for (var j = 0; j < matrixSize; j++)
                if (dist[i][j] > dist[i][k] + dist[k][j])
                  dist[i][j] = dist[i][k] + dist[k][j];

          for (var i = 0; i <= maxIndex; i++)
            for (var j = 0; j <= maxIndex; j++)
              context._d[i][j] = dist[i][j+maxIndex+1];
      }

      console.log('-------------  --------------');
      for (var i = 0; i < dataObjects.length; i++) {
        var str = "";
        for (var j = 0; j < dataObjects.length; j++) {
          str += sprintf("%10s ", context['_d'][i][j]);
        }
        console.log(str);
      }
  };

  var x = [];
  var y = [];

  for (var d = 1; d <= 10; d++) {
    computation(d);
    x.push(d);
    y.push(context['_d'][outputDataObjectIndex][outputDataObjectIndex]);
  }

    $('#myModal').modal();
    var plotDiv = document.getElementById('modal-body');
    Plotly.purge(plotDiv);
  	Plotly.plot( plotDiv, [{x: x, y: y }], {
  	margin: { t: 0 } } );
}


var buildMatrix = function(task, preds, succs, sourcePreds, label, labelId) {

    var htmlStr = "<div class=\"diagram-note\">" + //"<h3>"+ label +"</h3>
                  "<table>";
    htmlStr += "<tr><td/>";
    for (var j in succs) {
        var succ = succs[j];
        var name = shortenDataObjectName(succ.name);
        htmlStr += "<td>"+(name.length > 6? name.substring(0,6) + "...": name)+"</td>";
    }
    htmlStr += "</tr>";

    for (var i in sourcePreds) {
        var src = sourcePreds[i];
        htmlStr += "<tr><td>" + shortenDataObjectName(src.name) +"</td>";
        for (var j in succs) {
            var tgt = succs[j];
            var vp = document.flattenMatrix[src.id+";"+tgt.id] || "";
            htmlStr += "<td><input id='2;"+src.id+";"+tgt.id+";"+task.id+"' onchange='changeValue(this)' onfocus='gotFocus(this)' onblur='lostFocus(this)' value='"+vp+"'/></td>";
        }
        htmlStr += "</tr>";
    }

    if (preds && preds.length > 0) {
        var names = [],
            ids = [];
        for (var i in preds) {
            names.push(shortenDataObjectName(preds[i].name));
            ids.push(preds[i].id);
        }
        ids.sort();
        names.sort();

        var src = names.toString();

        htmlStr += "<tr><td>" + src + "</td>";
        for (var j in succs) {
            var tgt = succs[j];
            var vp = document.flattenMatrix[ids.toString() + ";" + tgt.id] || "";
            htmlStr += "<td><input id='1;" + ids.toString() + ";" + tgt.id + ";" + task.id + "' onchange='changeValue(this)' onfocus='gotFocus(this)' onblur='lostFocus(this)' value='" + vp + "'/></td>";
        }
        htmlStr += "</tr>";
    }

    for (var i in succs) {
        var src = succs[i];
        htmlStr += "<tr><td>" + shortenDataObjectName(src.name) +"</td>";
        for (var j in succs) {
            var tgt = succs[j];
            var vp = document.flattenMatrix[src.id+";"+tgt.id] || "";
            htmlStr += "<td><input id='2;"+src.id+";"+tgt.id+";"+task.id+"' onchange='changeValue(this)' onfocus='gotFocus(this)' onblur='lostFocus(this)' value='"+vp+"'/></td>";
        }
        htmlStr += "</tr>";
    }

    htmlStr += "</table></div>";

    return htmlStr;
};

function openDiagram(qrDiagram) {
    bpmnViewer.importXML(qrDiagram, function (err) {

        if (err) {
            return console.error('could not import BPMN 2.0 diagram', err);
        }

        var canvas = bpmnViewer.get('canvas'),
            overlays = bpmnViewer.get('overlays'),
            eventBus = bpmnViewer.get('eventBus'),
            elementRegistry = bpmnViewer.get('elementRegistry'),
            previousShape = null,
            selectedOutputDataObject = null,
            selectedInputDataObject = null;

        var dataObjectName2IdMap = {};
        elementRegistry.forEach( function (e) {
          if (e.type == "bpmn:DataObjectReference")
            dataObjectName2IdMap[shortenDataObjectName(e.businessObject.name)] = e.id;
        });
        elementRegistry.forEach(function (e) {
          if (e.type == "bpmn:Task") {
            var localMatrix = [];
            if (e.businessObject.documentation)
                localMatrix = JSON.parse(e.businessObject.documentation[0].text);

                for (var key in localMatrix) {
                  var re = /([A-Za-z0-9]+)(.?)/g;
                  var nkey = '', arr;

                  while ((arr = re.exec(key)) !== null)
                    nkey = nkey + dataObjectName2IdMap[arr[1]] + (arr[2] == '_' ? ',' : arr[2]);

                  document.flattenMatrix[nkey] = localMatrix[key];
                }
          }
        });

        document.analizeModel = function (param) {
            if (selectedOutputDataObject == null || selectedInputDataObject == null) return;
            for (var key in elementRegistry._elements) {
                var element = elementRegistry.get(key);
                if (element.type == "bpmn:Participant") {
                    var procDef = element.businessObject.processRef;
                    if (procDef.flowElements.length > 0)
                        analyzeDPOnProcessDef(procDef, selectedInputDataObject, selectedOutputDataObject, elementRegistry);
                } else if (element.type == "bpmn:Process") {
                    analyzeDPOnProcessDef(element.businessObject, selectedInputDataObject, selectedOutputDataObject, elementRegistry);
                }
            }
        };

        document.changeValue = function (param) {
            var ids = param.id.split(";");
            document.flattenMatrix[ids[1] + ";" + ids[2]] = param.value;
        };

        document.gotFocus = function (param) {
            var ids = param.id.split(";");
            if (ids[0] == 1) {
                var lids = ids[1].split(",");
                for (var i in lids)
                    canvas.addMarker(lids[i], 'highlight-src');
                canvas.addMarker(ids[2], 'highlight-tgt');
            } else if (ids[0] == 2) {
                if (ids[1] != ids[2]) {
                    canvas.addMarker(ids[1], 'highlight-src');
                    canvas.addMarker(ids[2], 'highlight-tgt');
                } else
                    canvas.addMarker(ids[1], 'highlight-both');
            }
        };

        document.lostFocus = function (param) {
            var ids = param.id.split(";");
            if (ids[0] == 1) {
                var lids = ids[1].split(",");
                for (var i in lids)
                    canvas.removeMarker(lids[i], 'highlight-src');
                canvas.removeMarker(ids[2], 'highlight-tgt');
            } else if (ids[0] == 2) {
                if (ids[1] != ids[2]) {
                    canvas.removeMarker(ids[1], 'highlight-src');
                    canvas.removeMarker(ids[2], 'highlight-tgt');
                } else
                    canvas.removeMarker(ids[1], 'highlight-both');
            }
        };

        // zoom to fit full viewport
        canvas.zoom('fit-viewport');

        eventBus.on('element.click', function (e) {

            if (previousShape != null)
                overlays.remove({element: previousShape});

            if (e.element.type == 'bpmn:Task') {
                var predecessors = [], sourcePredecessors = [];
                var successors = [];

                for (var i in e.element.businessObject.dataInputAssociations) {
                    var p = e.element.businessObject.dataInputAssociations[i].sourceRef[0];
                    var pp = elementRegistry.get(p.id);
                    if (!pp.incoming || pp.incoming.length == 0)
                        sourcePredecessors.push(p);
                    else
                        predecessors.push(p);
                }
                for (var i in e.element.businessObject.dataOutputAssociations)
                    successors.push(e.element.businessObject.dataOutputAssociations[i].targetRef);

                overlays.add(e.element, 'note', {
                    position: {
                        top: 0,
                        left: 0
                    },
                    html: buildMatrix(e.element, predecessors, successors, sourcePredecessors, 'Distance matrix')
                });

                previousShape = e.element;
                selectedOutputDataObject = null;
            } else if (e.element.type == 'bpmn:DataObjectReference') {
                if (e.element.incoming != null && e.element.incoming.length == 0) {

                    if (selectedInputDataObject != null)
                        canvas.removeMarker(selectedInputDataObject.id, 'highlight-in-dobj');

                    if (selectedInputDataObject == e.element)
                      selectedInputDataObject = null;
                    else {
                      selectedInputDataObject = e.element;
                      canvas.addMarker(selectedInputDataObject.id, 'highlight-in-dobj');
                    }
                    
                    // =========================
                    // The following block of code was intended to dynamically create
                    // a form to enter the information about the distance on input data objects
                    // -------------------------
                    // var shortName = shortenDataObjectName(e.element.businessObject.name);
                    // var html = '<div class="diagram-note">D(' + shortName + ', ' + shortName + '):<input type="text"></input></div>';
                    // overlays.add(e.element, 'note', {
                    //     position: {
                    //         bottom: 0,
                    //         right: 0
                    //     },
                    //     html: html
                    // });
                } else {
                  if (selectedOutputDataObject != null)
                      canvas.removeMarker(selectedOutputDataObject.id, 'highlight-out-dobj');

                  if (selectedOutputDataObject == e.element)
                    selectedOutputDataObject = null;
                  else {
                    selectedOutputDataObject = e.element;
                    canvas.addMarker(selectedOutputDataObject.id, 'highlight-out-dobj');
                  }
                }
                previousShape = e.element;
            }
        });

    });
}

function registerFileDrop(container, callback) {

    function handleFileSelect(e) {
        e.stopPropagation();
        e.preventDefault();

        var files = e.dataTransfer.files;

        var file = files[0];

        var reader = new FileReader();

        reader.onload = function(e) {

            var xml = e.target.result;

            callback(xml);
        };

        reader.readAsText(file);
    }

    function handleDragOver(e) {
        e.stopPropagation();
        e.preventDefault();

        e.dataTransfer.dropEffect = 'copy'; // Explicitly show this is a copy.
    }

    container.addEventListener('dragover', handleDragOver, false);
    container.addEventListener('drop', handleFileSelect, false);
}


////// file drag / drop ///////////////////////

// check file api availability
if (!window.FileList || !window.FileReader) {
    window.alert(
        'Looks like you use an older browser that does not support drag and drop. ' +
        'Try using Chrome, Firefox or the Internet Explorer > 10.');
} else {
    registerFileDrop(container, openDiagram);
}
