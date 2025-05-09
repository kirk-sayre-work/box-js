const lib = require("../lib");

// WARNING: Only handles a single global task object.
TaskFolderObject = {
    _tasks: {},
    GetTask: function(name) {
        lib.info('The sample looked for scheduled task "' + name + '".');
        if (typeof(this._tasks[name]) == "undefined") throw "task not found";
        return this._tasks[name];
    },

    RegisterTaskDefinition: function(name, taskObj) {
        var taskInfo = {
            name: name,
            path: taskObj.path,
            args: taskObj.args,
            workingDir: taskObj.workingDir,
        };
        if (typeof(taskObj.triggerObj) != "undefined") {
            taskInfo.triggerId = taskObj.triggerObj.id;
            taskInfo.triggerUserId = taskObj.triggerObj.userId;
        };
        lib.logIOC("Task", taskInfo, 'The sample registered task "' + name + '".');
        this._tasks[name] = taskObj;
    },
};

class TaskTriggerObject {

    constructor() {
    };

    set ID(v) {
        lib.info('The sample set a task trigger ID to "' + v + '".');
        this.id = v;
    };

    set UserId(v) {
        lib.info('The sample set a task user ID to "' + v + '".');
        this.userId = v;
    };    
};

//debug
var num = 0;
class TaskObject {

    constructor() {
        this.settings = {};
        this.triggers = {
            Create: function() {
                var r = new TaskTriggerObject();
                this.taskObj.triggerObj = r;
                return r;
            },
        };
        this.Actions = {
            Create: function() {
                return this.taskObj;
            },
        };
        this.Actions.Create.taskObj = this;
        this.Actions.Create = this.Actions.Create.bind(this.Actions.Create);
        this.triggers.Create.taskObj = this;
        this.triggers.Create = this.triggers.Create.bind(this.triggers.Create);
        this.debug = "DEBUG_" + (num++);
    };

    set Path(v) {
        lib.info('The sample set task path to "' + v + '".');
        this.path = v;
    };

    set Arguments(v) {
        lib.info('The sample set task arguments to "' + v + '".');
        this.args = v;
    };

    set WorkingDirectory(v) {
        lib.info('The sample set task working directory to "' + v + '".');
        this.workingDir = v;
    };

    RunEx() {
        lib.info('The sample ran a scheduled task.');
    };
};

function ScheduleService() {

    this.clazz = "ScheduleService";
    
    this.Language = undefined;
    this.Timeout = undefined;

    this.connect = () => {
        lib.info('The sample connected to the task scheduler.');
    };

    this.getfolder = root => {
        lib.info('The sample got a scheduled task folder object rooted at "' + root + '".');
        return TaskFolderObject;
    };

    this.newtask = () => {
        return new TaskObject();
    };
}

module.exports = lib.proxify(ScheduleService, "Schedule.Service");
