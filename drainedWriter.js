var DrainedWriter = function(writer) {
    var dataBuffer = [];
    var currentSegment = 0;
    var writtenDataLength = 0;
    var shouldWaitDrain = false;
    var callback;
    var callbackInvoked = false;
    var currentDataSegment = null;

    function invokeCallback() {
        if (callback && !callbackInvoked) {
            callback();
            callbackInvoked = true;
        }
    }

    this.write = function (chunk) {
        function writeIfAvailable(currentDataSegment) {
            writtenDataLength += currentDataSegment.length;
            if (!writer.write(currentDataSegment)) {
                shouldWaitDrain = true;
                writer.once('drain', continueWrite);
            }
        }

        function continueWrite() {
            shouldWaitDrain = false;

            for (; currentSegment < dataBuffer.length; currentSegment++) {
                var currentDataSegment = dataBuffer[currentSegment];
                if (currentDataSegment != "end") {

                    writeIfAvailable(currentDataSegment);
                    if (shouldWaitDrain) {
                        currentSegment++
                        break;
                    }
                } else {
                    invokeCallback();
                }
            }
        }

        if (shouldWaitDrain) {
            dataBuffer.push(chunk);
        } else {
            writeIfAvailable(chunk);
        }
    };

    this.end = function (cb) {
        callback = cb;

        //No waiting data
        if (currentSegment >= dataBuffer.length) {
            invokeCallback();
        } else {
            dataBuffer.push("end");
        }
    }
}

module.exports = DrainedWriter;