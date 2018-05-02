(function($) {
    var mainContainerHeight,
        wraperHeight = $('#wrapper').height();
    if (wraperHeight <= 768) {
        mainContainerHeight = 768;
    } else {
        mainContainerHeight = wraperHeight;
    }
    $('.main-container').css({
        height: mainContainerHeight
    });
    $('#video-container').css({
        width: $('.main-container').width(),
        height: $('.main-container').height()
    });
    $(function() {
        var resolution = Cookies.get("resolution") || "720p",
            maxFrameRate = Number(Cookies.get("maxFrameRate") || 30),
            //maxBitRate        = Number(Cookies.get("maxBitRate") || 750),
            channel = Cookies.get("roomName"),
            role = Cookies.get("clientRole"),
            remoteStreamList = [],
            client = AgoraRTC.createClient({mode: 'interop'}),
            disableAudio = false,
            disableVideo = false,
            hideLocalStream = false,
            fullscreenEnabled = false,
            accessTokenURL  = '/access_token?channelName=' + channel + '&uid=0&expiredTs=0',
            uid,
            localStream,
            lastLocalStreamId,
            isMixed = false,
            audioSelect = document.querySelector('select#audioSource'),
            videoSelect = document.querySelector('select#videoSource');

        /* Joining channel */
        (function initAgoraRTC() {
            $.get('/app_id', function(appId) {
                client.on('error', function(err) {
                    console.log(err);
                    if (err.reason === 'INVALID_CHANNEL_NAME') {
                        $.alert("Invalid channel name, Chinese characters are not allowed in channel name.");
                    }
                });
                client.init(appId, function (obj) {
                    console.log("AgoraRTC client initialized");

                    $.ajax({
                        url: accessTokenURL,
                        error: function() {
                            console.log("Failed to get access token");
                        },
                        success: function(response) {
                            client.join(response.access_token, channel, undefined, function(uid) {
                                console.log("User " + uid + " join channel successfully");
                                console.log("Timestamp: " + Date.now());
                                if (role === 'broadcaster') {
                                    getDevices();
                                    localStream = initLocalStream(uid);
                                    lastLocalStreamId = localStream.getId();
                                }
                            });
                        }
                    });
                });
            });
        }());

        function getDevices() {
            AgoraRTC.getDevices(function (devices) {
                for (var i = 0; i !== devices.length; ++i) {
                    var device = devices[i];
                    var option = document.createElement('option');
                    option.value = device.deviceId;
                    if (device.kind === 'audioinput') {
                        option.text = device.label || 'microphone ' + (audioSelect.length + 1);
                        audioSelect.appendChild(option);
                    } else if (device.kind === 'videoinput') {
                        option.text = device.label || 'camera ' + (videoSelect.length + 1);
                        videoSelect.appendChild(option);
                    } else {
                        console.log('Some other kind of source/device: ', device);
                  }
                }
            });
        }

        subscribeStreamEvents();
        subscribeMouseClickEvents();
        subscribeMouseHoverEvents();
        subscribeWindowResizeEvent();
        $("#room-name-meeting").html(channel);
        attachExitFullscreenEvent();

        // Initialize and display stream end

        // Utility functions definition
        function generateVideoProfile(resolution, frameRate) {
            switch (resolution) {
                case '120p':
                    result = "120P";
                    break;
                case '240p':
                    result = "240P";
                    break;
                case '360p':
                    if (frameRate === 15) {
                        result = "360P";
                    } else {
                        result = "360P_4";
                    }
                    break;
                case '480p':
                    if (frameRate === 15) {
                        result = "480P_8";
                    } else {
                        result = "480P_9";
                    }
                    break;
                case '720p':
                    if (frameRate === 15) {
                        result = "720P";
                    } else {
                        result = "720P_3";
                    }
                    break;
                case '1080p':
                    if (frameRate === 15) {
                        result = "1080P";
                    } else {
                        result = "1080P_3";
                    }
                    break;
                default:
                    // 720p, 30
                    // Do nothing
                    break;
            }
            return result;
        }

        function attachExitFullscreenEvent() {
            if (document.addEventListener) {
                document.addEventListener('webkitfullscreenchange', exitHandler, false);
                document.addEventListener('mozfullscreenchange', exitHandler, false);
                document.addEventListener('fullscreenchange', exitHandler, false);
                document.addEventListener('MSFullscreenChange', exitHandler, false);
            }

            function exitHandler() {
                if (document.webkitIsFullScreen || document.mozFullScreen || document.msFullscreenElement !== null) {
                    /* Run code on exit */
                    if (screenfull.enabled) {
                        fullscreenEnabled = screenfull.isFullscreen;
                    }
                }
            }
        }

        function initLocalStream(id, callback) {
            var videoProfile = generateVideoProfile(resolution, maxFrameRate);
            uid = id;
            if (localStream) {
                // local stream exist already
                client.unpublish(localStream, function(err) {
                    console.log("Unpublish failed with error: ", err);
                });
                localStream.close();
            }
            localStream = AgoraRTC.createStream({
                streamID: uid,
                audio: true,
                cameraId: videoSource.value,
                microphoneId: audioSource.value,
                video: true,
                screen: false
            });
            //localStream.setVideoResolution(resolution);
            //localStream.setVideoFrameRate([maxFrameRate, maxFrameRate]);
            //localStream.setVideoBitRate([maxBitRate, maxBitRate]);
            localStream.setVideoProfile(videoProfile);

            localStream.init(function() {
                console.log("Get UserMedia successfully");
                console.log(localStream);

                var size = calculateVideoSize();
                if (remoteStreamList.length === 0) {
                    removeStream('agora-remote', localStream.getId());
                    displayStream('agora-remote', localStream, size.width, size.height, '');
                } else if (remoteStreamList.length === 1) {
                    if (role === 'broadcaster') {
                        $("div[id^='agora-local']").remove();
                        displayStream('agora-local', localStream, 160, 120, 'local-partner-video');
                    }
                } else if (remoteStreamList.length === 3) {
                    // TODO FIXME
                }

                toggleFullscreenButton(false);
                toggleExpensionButton(false);
                client.publish(localStream, function(err) {
                    console.log("Timestamp: " + Date.now());
                    console.log("Publish local stream error: " + err);
                });
                client.on('stream-published');

                // workaround to remove bottom bar
                $("div[id^='bar_']").remove();

            }, function(err) {
                console.log("Local stream init failed.", err);
                displayInfo("Please check camera or audio devices on your computer, then try again.");
                $(".info").append("<div class='back'><a href='index.html'>Back</a></div>");
            });
            return localStream;
        }

        function displayInfo(info) {
            $(".info").append("<p>" + info + "</p>")
        }

        ;
        (function(global) {
            'use strict';
            // existing version for noConflict()
            var _Base64 = global.Base64;
            var version = "2.1.9";
            // if node.js, we use Buffer
            var buffer;
            if (typeof module !== 'undefined' && module.exports) {
                try {
                    buffer = require('buffer').Buffer;
                } catch (err) {}
            }
            // constants
            var b64chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
            var b64tab = function(bin) {
                var t = {};
                for (var i = 0, l = bin.length; i < l; i++) t[bin.charAt(i)] = i;
                return t;
            }(b64chars);
            var fromCharCode = String.fromCharCode;
            // encoder stuff
            var cb_utob = function(c) {
                if (c.length < 2) {
                    var cc = c.charCodeAt(0);
                    return cc < 0x80 ? c : cc < 0x800 ? (fromCharCode(0xc0 | (cc >>> 6)) + fromCharCode(0x80 | (cc & 0x3f))) : (fromCharCode(0xe0 | ((cc >>> 12) & 0x0f)) + fromCharCode(0x80 | ((cc >>> 6) & 0x3f)) + fromCharCode(0x80 | (cc & 0x3f)));
                } else {
                    var cc = 0x10000 + (c.charCodeAt(0) - 0xD800) * 0x400 + (c.charCodeAt(1) - 0xDC00);
                    return (fromCharCode(0xf0 | ((cc >>> 18) & 0x07)) + fromCharCode(0x80 | ((cc >>> 12) & 0x3f)) + fromCharCode(0x80 | ((cc >>> 6) & 0x3f)) + fromCharCode(0x80 | (cc & 0x3f)));
                }
            };
            var re_utob = /[\uD800-\uDBFF][\uDC00-\uDFFFF]|[^\x00-\x7F]/g;
            var utob = function(u) {
                return u.replace(re_utob, cb_utob);
            };
            var cb_encode = function(ccc) {
                var padlen = [0, 2, 1][ccc.length % 3],
                    ord = ccc.charCodeAt(0) << 16 | ((ccc.length > 1 ? ccc.charCodeAt(1) : 0) << 8) | ((ccc.length > 2 ? ccc.charCodeAt(2) : 0)),
                    chars = [
                        b64chars.charAt(ord >>> 18),
                        b64chars.charAt((ord >>> 12) & 63),
                        padlen >= 2 ? '=' : b64chars.charAt((ord >>> 6) & 63),
                        padlen >= 1 ? '=' : b64chars.charAt(ord & 63)
                    ];
                return chars.join('');
            };
            var btoa = global.btoa ? function(b) {
                return global.btoa(b);
            } : function(b) {
                return b.replace(/[\s\S]{1,3}/g, cb_encode);
            };
            var _encode = buffer ? function(u) {
                return (u.constructor === buffer.constructor ? u : new buffer(u))
                    .toString('base64')
            } : function(u) {
                return btoa(utob(u))
            };
            var encode = function(u, urisafe) {
                return !urisafe ? _encode(String(u)) : _encode(String(u)).replace(/[+\/]/g, function(m0) {
                    return m0 == '+' ? '-' : '_';
                }).replace(/=/g, '');
            };
            var encodeURI = function(u) {
                return encode(u, true)
            };
            // decoder stuff
            var re_btou = new RegExp([
                '[\xC0-\xDF][\x80-\xBF]',
                '[\xE0-\xEF][\x80-\xBF]{2}',
                '[\xF0-\xF7][\x80-\xBF]{3}'
            ].join('|'), 'g');
            var cb_btou = function(cccc) {
                switch (cccc.length) {
                    case 4:
                        var cp = ((0x07 & cccc.charCodeAt(0)) << 18) | ((0x3f & cccc.charCodeAt(1)) << 12) | ((0x3f & cccc.charCodeAt(2)) << 6) | (0x3f & cccc.charCodeAt(3)),
                            offset = cp - 0x10000;
                        return (fromCharCode((offset >>> 10) + 0xD800) + fromCharCode((offset & 0x3FF) + 0xDC00));
                    case 3:
                        return fromCharCode(
                            ((0x0f & cccc.charCodeAt(0)) << 12) | ((0x3f & cccc.charCodeAt(1)) << 6) | (0x3f & cccc.charCodeAt(2))
                        );
                    default:
                        return fromCharCode(
                            ((0x1f & cccc.charCodeAt(0)) << 6) | (0x3f & cccc.charCodeAt(1))
                        );
                }
            };
            var btou = function(b) {
                return b.replace(re_btou, cb_btou);
            };
            var cb_decode = function(cccc) {
                var len = cccc.length,
                    padlen = len % 4,
                    n = (len > 0 ? b64tab[cccc.charAt(0)] << 18 : 0) | (len > 1 ? b64tab[cccc.charAt(1)] << 12 : 0) | (len > 2 ? b64tab[cccc.charAt(2)] << 6 : 0) | (len > 3 ? b64tab[cccc.charAt(3)] : 0),
                    chars = [
                        fromCharCode(n >>> 16),
                        fromCharCode((n >>> 8) & 0xff),
                        fromCharCode(n & 0xff)
                    ];
                chars.length -= [0, 0, 2, 1][padlen];
                return chars.join('');
            };
            var atob = global.atob ? function(a) {
                return global.atob(a);
            } : function(a) {
                return a.replace(/[\s\S]{1,4}/g, cb_decode);
            };
            var _decode = buffer ? function(a) {
                return (a.constructor === buffer.constructor ? a : new buffer(a, 'base64')).toString();
            } : function(a) {
                return btou(atob(a))
            };
            var decode = function(a) {
                return _decode(
                    String(a).replace(/[-_]/g, function(m0) {
                        return m0 == '-' ? '+' : '/'
                    })
                    .replace(/[^A-Za-z0-9\+\/]/g, '')
                );
            };
            var noConflict = function() {
                var Base64 = global.Base64;
                global.Base64 = _Base64;
                return Base64;
            };
            // export Base64
            global.Base64 = {
                VERSION: version,
                atob: atob,
                btoa: btoa,
                fromBase64: decode,
                toBase64: encode,
                utob: utob,
                encode: encode,
                encodeURI: encodeURI,
                btou: btou,
                decode: decode,
                noConflict: noConflict
            };
            // if ES5 is available, make Base64.extendString() available
            if (typeof Object.defineProperty === 'function') {
                var noEnum = function(v) {
                    return { value: v, enumerable: false, writable: true, configurable: true };
                };
                global.Base64.extendString = function() {
                    Object.defineProperty(
                        String.prototype, 'fromBase64', noEnum(function() {
                            return decode(this)
                        }));
                    Object.defineProperty(
                        String.prototype, 'toBase64', noEnum(function(urisafe) {
                            return encode(this, urisafe)
                        }));
                    Object.defineProperty(
                        String.prototype, 'toBase64URI', noEnum(function() {
                            return encode(this, true)
                        }));
                };
            }
            // that's it!
            if (global['Meteor']) {
                Base64 = global.Base64; // for normal export in Meteor.js
            }
        })(window);

        function removeStreamFromList(id) {
            var index, tmp;
            for (index = 0; index < remoteStreamList.length; index += 1) {
                var tmp = remoteStreamList[index];
                if (tmp.id === id) {
                    var toRemove = remoteStreamList.splice(index, 1);
                    if (toRemove.length === 1) {
                        //delete toRemove[1];
                        console.log("stream stopping..." + toRemove[0].stream.getId());
                        toRemove[0].stream.stop();
                        return true;
                    }
                }
            }
            return false;
        }

        function removeStream(tagId, streamId) {
            var streamDiv = $("#" + tagId + streamId);
            if (streamDiv && streamDiv.length > 0) {
                streamDiv.remove();
            }
        }

        function addToRemoteStreamList(stream, videoEnabled, audioEnabled) {
            if (stream) {
                remoteStreamList.push({
                    id: stream.getId(),
                    stream: stream,
                    videoEnabled: videoEnabled,
                    audioEnabled: audioEnabled
                });
            }
        }

        function removeElementIfExist(tagId, uid) {
            $("#" + tagId + uid).remove();
        }

        function displayStream(tagId, stream, width, height, className, parentNodeId) {
            // cleanup, if network connection interrupted, user cannot receive any events.
            // after reconnecting, the same node id is reused,
            // so remove html node with same id if exist.

            removeElementIfExist(tagId, stream.getId());

            var $container;
            if (parentNodeId) {
                $container = $("#" + parentNodeId);
            } else {
                $container = $("#video-container-multiple");
            }

            // mixed mode
            if (isMixed) {
                width = 192;
                height = 120;
                className = 'video-item';
            } else {
                className += ' video-item';
            }

            var styleStr = 'width:' + width + 'px; height:' + height + 'px;';

            if (className.indexOf('local-partner-video') > -1) {
                var videoWidth = $('#wrapper').height() * 4 / 3;
                var right = (1200 - videoWidth) / 2 + 12;

                styleStr += 'top:12px; right:' + right + 'px;';
            }

            $container.append('<div id="' + tagId + stream.getId() + '" class="' + className + '" data-stream-id="' + stream.getId() + '" style="' + styleStr + '"></div>');

            // $("#" + tagId + stream.getId()).css();
            stream.play(tagId + stream.getId());
        }

        function addPlaceholderDiv(parentNodeId, width, height) {
            var placehoder = $("#placeholder-div");
            if (placehoder.length === 0 && !isMixed) {
                $("#" + parentNodeId).append("<div id='placeholder-div' style='width:" + width + "px;height:" + height + "px' class='col-sm-6 remote-partner-video-multiple'></div>");
            }
        }

        function addNewRows(parentNodeId) {
            var row1 = $("#video-row1"),
                row2 = $("#video-row2");
            if (row1 && row1.length === 0) {
                $("#" + parentNodeId).append("<div id='video-row1' class='row'></div>");
            }

            if (row2 && row2.length === 0) {
                $("#" + parentNodeId).append("<div id='video-row2' class='row'></div>");
            }
        }

        function toggleFullscreenButton(show, parent) {
            if (parent) {
                $(parent + " .fullscreen-button").parent().toggle(show);
                $(parent + " .fullscreen-button, " + parent + " .fullscreen-button>img").toggle(show);
            } else {
                $("#video-container .fullscreen-button").parent().toggle(show);
                $("#video-container .fullscreen-button, #video-container .fullscreen-button>img").toggle(show);
            }
        }

        function toggleExpensionButton(show, parent) {
            if (parent) {
                $(parent + " .expension-button").parent().toggle(show);
                $(parent + " .expension-button, " + parent + " .expension-button>img").toggle(show);
            } else {
                // var reference = $('.local-partner-video')
                //     top = '0px',
                //     rigjt = '0px';

                // if(reference[0]){
                //     var top = reference.css('top');
                //     var right = reference.css('right');
                // }

                $("#video-container .expension-button")
                    .parent()
                    // .css({
                    //     'position' : 'absolute',
                    //     'top' : top,
                    //     'right' : right,
                    //     'zIndex': 10
                    // })
                    .toggle(show);
                $("#video-container .expension-button, #video-container .expension-button>img").toggle(show);
            }
        }

        function addingMuteSpeakIcon(streamId) {
            $("#agora-remote" + streamId).append("<a class='remote-mute-speak-icon' data-stream-id='" + streamId + "' href='#'><img src='images/icon_mute.png'></a>");

            $(".remote-mute-speak-icon").off("click").on("click", function(e) {
                var streamId = Number($(e.target).parent().data("stream-id"));
                var index, length, obj;
                for (index = 0, length = remoteStreamList.length; index < length; index += 1) {
                    obj = remoteStreamList[index];
                    if (obj.id === streamId) {
                        if (obj.audioEnabled) {
                            obj.stream.disableAudio();
                            obj.audioEnabled = false;
                            $(e.target).attr("src", "images/icon_speak.png");
                        } else {
                            obj.stream.enableAudio();
                            obj.audioEnabled = true;
                            $(e.target).attr("src", "images/icon_mute.png");
                        }
                    }
                }
            });
        }

        function showStreamOnPeerLeave(streamId) {
            var size;
            var removed = removeStreamFromList(Number(streamId));
            if (!removed) {
                return;
            }

            if (remoteStreamList.length === 0) {
                clearAllStream();
                size = calculateVideoSize(false);

                if (role === 'broadcaster') {
                    displayStream("agora-local", localStream, size.width, size.height, '');
                }

                toggleFullscreenButton(false);
                toggleExpensionButton(false);
            } else if (remoteStreamList.length === 1) {
                clearAllStream();
                size = calculateVideoSize(false);

                displayStream("agora-remote", remoteStreamList[0].stream, size.width, size.height, '');
                if (role === 'broadcaster') {
                    displayStream("agora-local", localStream, 160, 120, 'local-partner-video');
                }

                toggleFullscreenButton(true);
                toggleExpensionButton(true);
            } else if (remoteStreamList.length === 2) {
                clearAllStream();
                addNewRows("video-container-multiple");
                size = calculateVideoSize(true);

                // row 1
                displayStream("agora-remote", remoteStreamList[0].stream, size.width, size.height, "remote-partner-video-multiple col-sm-6", "video-row1");
                displayStream("agora-remote", remoteStreamList[1].stream, size.width, size.height, "remote-partner-video-multiple col-sm-6", "video-row1");

                // row 2
                if (role === 'broadcaster') {
                    displayStream("agora-local", localStream, size.width, size.height, "remote-partner-video-multiple col-sm-6", "video-row2");
                    addPlaceholderDiv("video-row2", size.width, size.height);
                }
            } else if (remoteStreamList.length === 3) {
                clearAllStream();
                addNewRows("video-container-multiple");
                size = calculateVideoSize(true);

                // row 1
                displayStream("agora-remote", remoteStreamList[0].stream, size.width, size.height, "remote-partner-video-multiple col-sm-6", "video-row1");
                displayStream("agora-remote", remoteStreamList[1].stream, size.width, size.height, "remote-partner-video-multiple col-sm-6", "video-row1");

                // row 2
                displayStream("agora-remote", remoteStreamList[2].stream, size.width, size.height, "remote-partner-video-multiple col-sm-6", "video-row2");
                if (role === 'broadcaster') {
                    displayStream("agora-local", localStream, size.width, size.height, "remote-partner-video-multiple col-sm-6", "video-row2");
                }
            } else if (remoteStreamList.length === 4) {
                clearAllStream();
                addNewRows("video-container-multiple");
                size = calculateVideoSize(true);

                // row 1
                displayStream("agora-remote", remoteStreamList[0].stream, size.width, size.height, "remote-partner-video-multiple col-sm-6", "video-row1");
                displayStream("agora-remote", remoteStreamList[1].stream, size.width, size.height, "remote-partner-video-multiple col-sm-6", "video-row1");

                // row 2
                displayStream("agora-remote", remoteStreamList[2].stream, size.width, size.height, "remote-partner-video-multiple col-sm-6", "video-row2");
                remoteStreamList[3].stream.enableVideo();
                displayStream("agora-remote", remoteStreamList[3].stream, size.width, size.height, "remote-partner-video-multiple col-sm-6", "video-row2");
            } else {
                removeStream('agora-remote', streamId);
            }

            // workaround to remove bottom bar
            $("div[id^='bar_']").remove();
        }

        function stopLocalAndRemoteStreams() {
            if (localStream) {
                localStream.stop();
            }
            var index, length;
            for (index = 0, length = remoteStreamList.length; index < length; index += 1) {
                remoteStreamList[index].stream.stop();
            }
        }

        function clearAllStream() {
            stopLocalAndRemoteStreams();
            $("#video-container-multiple").empty();
        }

        function createAudioContainer() {
            var container = $("#audio-container");
            if (container && container.length > 0) {
                return;
            }
            $("#video-container-multiple").append("<div id='audio-container' style='display: none;'></div>");
        }

        function showStreamOnPeerAdded(stream) {

            var size;

            if (remoteStreamList.length === 0) {
                clearAllStream();
                size = calculateVideoSize(false);

                if (role === 'broadcaster') {
                    displayStream('agora-local', localStream, 160, 120, 'local-partner-video');
                }
                displayStream("agora-remote", stream, size.width, size.height, '');

                toggleFullscreenButton(true);
                toggleExpensionButton(true);
            } else if (remoteStreamList.length === 1) {
                clearAllStream();
                addNewRows("video-container-multiple");
                size = calculateVideoSize(true);

                displayStream("agora-remote", remoteStreamList[0].stream, size.width, size.height, "remote-partner-video-multiple col-sm-6", "video-row1");
                displayStream("agora-remote", stream, size.width, size.height, "remote-partner-video-multiple col-sm-6", "video-row1");
                if (role === 'broadcaster') {
                    displayStream("agora-local", localStream, size.width, size.height, 'remote-partner-video-multiple col-sm-6', "video-row2");
                    addPlaceholderDiv("video-row2", size.width, size.height);
                }

                toggleFullscreenButton(false);
                toggleExpensionButton(false);
            } else if (remoteStreamList.length === 2) {
                clearAllStream();
                addNewRows("video-container-multiple");
                size = calculateVideoSize(true);

                // row 1
                displayStream("agora-remote", remoteStreamList[0].stream, size.width, size.height, "remote-partner-video-multiple col-sm-6", "video-row1");
                displayStream("agora-remote", remoteStreamList[1].stream, size.width, size.height, "remote-partner-video-multiple col-sm-6", "video-row1");
                // row 2
                displayStream("agora-remote", stream, size.width, size.height, 'remote-partner-video-multiple col-sm-6', 'video-row2');
                if (role === 'broadcaster') {
                    displayStream("agora-local", localStream, size.width, size.height, 'remote-partner-video-multiple col-sm-6', "video-row2");
                }
            } else if (remoteStreamList.length === 3) {
                clearAllStream();
                addNewRows("video-container-multiple");
                size = calculateVideoSize(true);

                // row 1
                displayStream("agora-remote", remoteStreamList[0].stream, size.width, size.height, "remote-partner-video-multiple col-sm-6", "video-row1");
                displayStream("agora-remote", remoteStreamList[1].stream, size.width, size.height, "remote-partner-video-multiple col-sm-6", "video-row1");
                // row 2
                displayStream("agora-remote", remoteStreamList[2].stream, size.width, size.height, "remote-partner-video-multiple col-sm-6", "video-row2");
                displayStream("agora-remote", stream, size.width, size.height, 'remote-partner-video-multiple col-sm-6', 'video-row2');
            } else if (remoteStreamList.length === 4) {
                clearAllStream();
                addNewRows("video-container-multiple");
                size = calculateVideoSize(true);

                // row 1
                displayStream("agora-remote", remoteStreamList[0].stream, size.width, size.height, "remote-partner-video-multiple col-sm-6", "video-row1");
                displayStream("agora-remote", remoteStreamList[1].stream, size.width, size.height, "remote-partner-video-multiple col-sm-6", "video-row1");
                // row 2
                displayStream("agora-remote", remoteStreamList[2].stream, size.width, size.height, "remote-partner-video-multiple col-sm-6", "video-row2");
                displayStream("agora-remote", remoteStreamList[3].stream, size.width, size.height, "remote-partner-video-multiple col-sm-6", "video-row2");

                // we only allow 4 vidwo streams to display at the same time
                createAudioContainer();
                stream.disableVideo();
                displayStream("agora-remote", stream, 0, 0, "", "audio-container");
            } else {
                stream.disableVideo();
                displayStream("agora-remote", stream, 0, 0, "", "audio-container");
            }

            addToRemoteStreamList(stream, true, true);
            // workaround to remove bottom bar
            $("div[id^='bar_']").remove();
        }

        function subscribeStreamEvents() {
            client.on('stream-added', function(evt) {
                var stream = evt.stream;
                console.log("New stream added: " + stream.getId());
                console.log("Timestamp: " + Date.now());
                console.log("Subscribe ", stream);
                client.subscribe(stream, function(err) {
                    console.log("Subscribe stream failed", err);
                });
            });

            client.on('peer-leave', function(evt) {
                console.log("Peer has left: " + evt.uid);
                console.log("Timestamp: " + Date.now());
                console.log(evt);
                showStreamOnPeerLeave(evt.uid);
                //updateRoomInfo();
            });

            client.on('stream-subscribed', function(evt) {
                var stream = evt.stream;
                console.log("Got stream-subscribed event");
                console.log("Timestamp: " + Date.now());
                console.log("Subscribe remote stream successfully: " + stream.getId());
                console.log(evt);
                showStreamOnPeerAdded(stream);
                //updateRoomInfo();
            });

            client.on("stream-removed", function(evt) {
                var stream = evt.stream;
                console.log("Stream removed: " + evt.stream.getId());
                console.log("Timestamp: " + Date.now());
                console.log(evt);
                showStreamOnPeerLeave(evt.stream.getId());
                //updateRoomInfo();
            });
        }

        function subscribeWindowResizeEvent() {
            var videoSize;
            $(window).resize(function(e) {
                if (fullscreenEnabled) {
                    return;
                }
                if (remoteStreamList.length === 0 || remoteStreamList.length === 1) {
                    videoSize = calculateVideoSize(false);
                } else {
                    videoSize = calculateVideoSize(true);
                }
                resizeStreamOnPage(videoSize);
            });
        }

        function resizeStreamOnPage(size) {
            if (!size) {
                return;
            }

            clearAllStream();
            var width = size.width,
                height = size.height;

            if (remoteStreamList.length === 0) {
                if (role === 'broadcaster') {
                    displayStream('agora-local', localStream, width, height, 'video-item');
                }
                toggleFullscreenButton(false);
                toggleExpensionButton(false);
            } else if (remoteStreamList.length === 1) {
                displayStream("agora-remote", remoteStreamList[0].stream, width, height, 'video-item');

                // TODO resize local video
                if (role === 'broadcaster') {
                    displayStream('agora-local', localStream, 160, 120, 'local-partner-video');
                }
            } else if (remoteStreamList.length === 2) {
                addNewRows("video-container-multiple");

                displayStream("agora-remote", remoteStreamList[0].stream, size.width, size.height, "remote-partner-video-multiple col-sm-6", "video-row1");
                displayStream("agora-remote", remoteStreamList[1].stream, size.width, size.height, "remote-partner-video-multiple col-sm-6", "video-row1");
                if (role === 'broadcaster') {
                    displayStream("agora-local", localStream, size.width, size.height, 'remote-partner-video-multiple col-sm-6', "video-row2");
                    addPlaceholderDiv("video-row2", size.width, size.height);
                }

                toggleFullscreenButton(false);
                toggleExpensionButton(false);
            } else if (remoteStreamList.length === 3) {
                addNewRows("video-container-multiple");

                // row 1
                displayStream("agora-remote", remoteStreamList[0].stream, size.width, size.height, "remote-partner-video-multiple col-sm-6", "video-row1");
                displayStream("agora-remote", remoteStreamList[1].stream, size.width, size.height, "remote-partner-video-multiple col-sm-6", "video-row1");
                // row 2
                displayStream("agora-remote", remoteStreamList[2].stream, size.width, size.height, 'remote-partner-video-multiple col-sm-6', 'video-row2');
                if (role === 'broadcaster') {
                    displayStream("agora-local", localStream, size.width, size.height, 'remote-partner-video-multiple col-sm-6', "video-row2");
                }
            } else if (remoteStreamList.length === 4) {
                addNewRows("video-container-multiple");

                // row 1
                displayStream("agora-remote", remoteStreamList[0].stream, size.width, size.height, "remote-partner-video-multiple col-sm-6", "video-row1");
                displayStream("agora-remote", remoteStreamList[1].stream, size.width, size.height, "remote-partner-video-multiple col-sm-6", "video-row1");
                // row 2
                displayStream("agora-remote", remoteStreamList[2].stream, size.width, size.height, 'remote-partner-video-multiple col-sm-6', 'video-row2');
                displayStream("agora-remote", remoteStreamList[3].stream, size.width, size.height, 'remote-partner-video-multiple col-sm-6', "video-row2");
            } else {
                addNewRows("video-container-multiple");

                // row 1
                displayStream("agora-remote", remoteStreamList[0].stream, size.width, size.height, "remote-partner-video-multiple col-sm-6", "video-row1");
                displayStream("agora-remote", remoteStreamList[1].stream, size.width, size.height, "remote-partner-video-multiple col-sm-6", "video-row1");
                // row 2
                displayStream("agora-remote", remoteStreamList[2].stream, size.width, size.height, 'remote-partner-video-multiple col-sm-6', 'video-row2');
                displayStream("agora-remote", remoteStreamList[3].stream, size.width, size.height, 'remote-partner-video-multiple col-sm-6', "video-row2");

                // we only allow 4 vidwo streams to display at the same time
                createAudioContainer();
                stream.disableVideo();
                displayStream("agora-remote", stream, 0, 0, "", "audio-container");
            }

            // workaround to remove bottom bar
            $("div[id^='bar_']").remove();
        }

        function getResolutionArray(reso) {
            switch (reso) {
                case "120p":
                    return [160, 120];
                case "240p":
                    return [320, 240];
                case "360p":
                    return [640, 360];
                case "480p":
                    return [848, 480];
                case "720p":
                    return [1280, 720];
                case "1080p":
                    return [1920, 1080];
                default:
                    return [1280, 720];
            }
        }

        function calculateVideoSize(multiple) {
            var viewportWidth = $(window).width(),
                viewportHeight = $(window).height(),
                curResolution = getResolutionArray(resolution),
                width,
                height,
                newWidth,
                newHeight,
                ratioWindow,
                ratioVideo;

            if (multiple) {
                width = viewportWidth / 2 - 50;
                height = viewportHeight / 2 - 40;
            } else {
                width = viewportWidth - 100;
                height = viewportHeight - 80;
            }
            ratioWindow = width / height;
            ratioVideo = curResolution[0] / curResolution[1];
            if (ratioVideo > ratioWindow) {
                // calculate by width
                newWidth = width;
                newHeight = width * curResolution[1] / curResolution[0];
            } else {
                // calculate by height
                newHeight = height;
                newWidth = height * curResolution[0] / curResolution[1];
            }

            newWidth = Math.max(newWidth, 160);
            newHeight = Math.max(newHeight, 120);
            return {
                width: newWidth,
                height: newHeight
            };
        }

        function subscribeMouseHoverEvents() {
            $(".mute-button").off("hover").hover(function(e) {
                if (disableAudio) {
                    $(e.target).attr("src", "images/@2x.png");
                } else {
                    $(e.target).attr("src", "images/btn_mute_touch.png");
                }
            }, function(e) {
                if (disableAudio) {
                    $(e.target).attr("src", "images/btn_mute_touch.png");
                } else {
                    $(e.target).attr("src", "images/btn_mute@2x.png");
                }
            });

            $(".switch-audio-button").off("hover").hover(function(e) {
                if (disableVideo) {
                    $(e.target).attr("src", "images/btn_video_touchpush@2x.png");
                } else {
                    $(e.target).attr("src", "images/btn_voice_touchpush@2x.png");
                }
            }, function(e) {
                if (disableVideo) {
                    $(e.target).attr("src", "images/btn_video@2x.png");
                } else {
                    $(e.target).attr("src", "images/btn_voice@2x.png");
                }
            });

            $(".fullscreen-button").off("hover").hover(function(e) {
                if (fullscreenEnabled) {
                    $(e.target).attr("src", "images/btn_maximize_blue_touchpush@2x.png");
                } else {
                    $(e.target).attr("src", "images/btn_maximize_touchpush@2x.png");
                }
            }, function(e) {
                if (screenfull.isFullscreen) {
                    $(e.target).attr("src", "images/btn_maximize_blue@2x.png");
                } else {
                    $(e.target).attr("src", "images/btn_maximize@2x.png");
                }
            });

            $(".end-call-button").off("hover").hover(function(e) {
                $(e.target).attr("src", "images/btn_endcall_touchpush@2x.png");
            }, function(e) {
                $(e.target).attr("src", "images/btn_endcall@2x.png");
            });

            $(".expension-button").off("hover").hover(function(e) {
                if (hideLocalStream) {
                    $(e.target).attr("src", "images/btn_expansion.png");
                } else {
                    $(e.target).attr("src", "images/btn_expansion_touch.png");
                }
            }, function(e) {
                if (hideLocalStream) {
                    $(e.target).attr("src", "images/btn_expansion_touch.png");
                } else {
                    $(e.target).attr("src", "images/btn_expansion.png");
                }
            });

            $(".mute-button").off("hover").hover(function(e) {
                if (disableAudio) {
                    $(e.target).attr("src", "images/btn_mute_blue_touchpush@2x.png");
                } else {
                    $(e.target).attr("src", "images/btn_mute_touchpush@2x.png");
                }
            }, function(e) {
                if (disableAudio) {
                    $(e.target).attr("src", "images/btn_mute_blue@2x.png");
                } else {
                    $(e.target).attr("src", "images/btn_mute@2x.png");
                }
            });


            $(".video-container").off("mouseover").mousemove(function(e) {
                $(".toolbar").addClass("toolbar-hover");
                if (window.mousemoveTimeoutHandler) {
                    window.clearTimeout(window.mousemoveTimeoutHandler);
                }
                window.mousemoveTimeoutHandler = setTimeout(function() {
                    $(".toolbar").removeClass("toolbar-hover");
                }, 5000);
            });

            // $(".toolbar img").off("hover").hover(function(e) {
            //     $(this).filter(':not(:animated)').animate({ width: "70px", height: "70px" });
            // }, function() {
            //     $(this).animate({ width: "50px", height: "50px" });
            // });
        }

        function subscribeMouseClickEvents() {
            // Adding events handlers
            $(".mute-button,.list-switch-audio-btn").off("click").on("click", function(e) {
                disableAudio = !disableAudio;

                var target = $(this),
                    isMixed = target.hasClass('list-switch-audio-btn'),
                    mixedClassName = 'list-switch-audio-disable-btn';

                if (disableAudio) {

                    if (isMixed) {
                        target.addClass(mixedClassName);
                    } else {
                        target.attr("src", "images/btn_mute_touch.png");
                    }
                    localStream.disableAudio();
                } else {
                    if (isMixed) {
                        target.removeClass(mixedClassName);
                    } else {
                        target.attr("src", "images/btn_mute@2x.png");
                    }
                    localStream.enableAudio();
                }

                // if (disableAudio) {
                //     localStream.disableAudio();
                //     $(e.target).attr("src", "images/btn_mute_touch.png");
                // } else {
                //     localStream.enableAudio();
                //     $(e.target).attr("src", "images/btn_mute@2x.png");
                // }
            });

            $(".switch-audio-button").off("click").click(function(e) {
                disableVideo = !disableVideo;
                if (disableVideo) {
                    localStream.disableVideo();
                    $(e.target).attr("src", "images/btn_video.png");
                    $("#stream" + localStream.getId()).css({ display: 'none' });
                    $("#stream" + lastLocalStreamId).css({ display: 'none' });

                    $("#player_" + localStream.getId()).css({
                        "background-color": "#4b4b4b",
                        "background-image": "url(images/icon_default.png)",
                        "background-repeat": "no-repeat",
                        "background-position": "center center"
                    });
                    $("#player_" + lastLocalStreamId).css({
                        "background-color": '#4b4b4b',
                        "background-image": "url(images/icon_default.png)",
                        "background-repeat": "no-repeat",
                        "background-position": "center center"
                    });
                } else {
                    localStream.enableVideo();
                    $(e.target).attr("src", "images/btn_voice.png");
                    $("#stream" + localStream.getId()).css({ display: 'block' });
                    $("#stream" + lastLocalStreamId).css({ display: 'block' });
                }
            });

            $(".fullscreen-button").off("click").click(function(e) {
                var target;
                fullscreenEnabled = !fullscreenEnabled;
                if (screenfull.enabled) {
                    if (screenfull.isFullscreen) {
                        screenfull.exit();
                        $(e.target).attr("src", "images/btn_maximize.png");
                    } else {
                        var videoWrapper = $("div[id^='agora-remote']")[0];
                        target = $(videoWrapper).find("canvas")[0];
                        screenfull.request(target);
                        $(e.target).attr("src", "images/btn_reduction.png");
                    }
                } else {
                    // TODO will we provide fallback for older browsers??
                }
            });

            $(".expension-button").off("click").click(function(e) {
                hideLocalStream = !hideLocalStream;

                if (hideLocalStream) {
                    $("div[id^='agora-local']").remove();
                } else {
                    if (role === 'broadcaster') {
                        displayStream("agora-local", localStream, 160, 120, 'local-partner-video');
                    }
                }
                // workaround to remove bottom bar
                $("div[id^='bar_']").remove();
            });

            $(".end-call-button,.list-hang-up-btn").click(function(e) {
                client.leave();
                window.location.href = "index.html";
            });

            $(".list-close-btn").click(function(e) {

                $('.video-side-bar').hide();

                $('.toolbar').show();

                isMixed = false;

                var canvas = videoContainerMultiple.find('canvas');
                for (var i = 0, len = canvas.length; i < len; i++) {
                    canvas.eq(i).attr('style', canvas.eq(i).data('style'));
                }

                videoContainerMultiple.removeClass('to-side');

            });
        }
    });
}(jQuery));