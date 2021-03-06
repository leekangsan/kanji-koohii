/**
 * Core.Ui.AjaxQueue handles single and mutliple ajax requests in sequential fashion.
 *
 * Simply queue() urls and options as for uiAjaxRequest, and the callbacks will
 * be called in sequence.
 *
 * Additionally:
 *
 * - Timeout and errors will display an error dialog. Clicking reconnect will
 *   resend the last request. The success notification is only fired when the request
 *   succesfully through.
 *
 * - Server-side ajax exceptions can set the error message through the 'RTK-Error'
 *   HTTP Header. It will show in the connection error dialog.
 * 
 * Methods:
 *
 *   initialize(options)
 *   add(url, options)                Url and options passed straight to Core.Ui.AjaxRequest.
 *                                    The property options.argument becomes the argument for the "onSuccess" notification.
 *                                    EXCEPT set options.events, DO NOT USE the AjaxRequest callbacks.
 *
 *   start()
 *   busy()                           Returns true if the queue is currently running.
 *
 * Options:
 *
 *   elError    {String|HTMLElement}  Dialog displayed when a connection error occured (anything other
 *                                    than HTTP 200. Element style display will be set to 'block'.
 *                                    Must contain child element with class "uiFcAjaxError_msg" which will be
 *                                    set to the error message. Must contain a link that will enable
 *                                    use to reconnect (retry the last request, continue the queue).
 *
 *   elLoading  {String|HTMLElement}  Element displayed during ajax requests. Should contain an ajax
 *                                    loading animation icon.
 *
 *   events     {Object}              Cf. notifications.
 *
 *
 * Notifications:
 *
 *   onSuccess                        Succesfull (HTTP 200 ONLY) request. callback(o, argument) where o is the
 *                                    YUI Connect object (augmented by AjaxRequest with responseJSON etc),
 *                                    and argument is the "argument" option supplied to add() (optional).
 *   onQueueStart
 *   onQueueEnd
 * 
 * @author   Fabrice Denis
 */

const AjaxQueue = Core.make();
  
  // internal shorthands
const Y = YAHOO,
      Dom = Y.util.Dom,
      Event = Y.util.Event;

  AjaxQueue.prototype =
  {
    blobs:          [],
    curblob:        null,
    flow:           false,

    ajaxRequest:    null,
    ajaxIndicator:  null,
    elAjaxError:    null,

    init: function(options)
    {
      this.blobs = [];
      this.flow  = false;

      // events
      this.eventDispatcher = new Core.Ui.EventDispatcher();
      if (options.events)
      {
        for (var sEvent in options.events) {
          this.eventDispatcher.connect(sEvent, options.events[sEvent]);
        }
      }

      // init error dialog 
      this.elAjaxError = Dom.get(options.elError);
      var elAction = this.elAjaxError.getElementsByTagName('a')[0];
      Event.on(elAction, "click", this.reconnectEvent, this, true);

      // init ajax loading icon
      this.ajaxIndicator = Dom.get(options.elLoading);
    },

    /**
     * Add a new request to the queue.
     *
     * Parameters as for AjaxRequest constructor.
     *
     * @see  Core.Ui.AjaxRequest for all options.
     */
    add: function(url, options)
    {
      // set some defaults
      options.method = options.method || "post";

      options.scope   = this;

      // ajax queue callbacks
      options.success = this.onAjaxSuccess;
      options.failure = this.onAjaxFailure;

      // transaction-level events
      options.customevents = {
        onStart:    this.onAjaxStart,
        onComplete: this.onAjaxComplete
      };

      this.blobs.push({
        url:      url,
        options:  options
      });
    },

    start: function()
    {
      if (this.flow) {
        return false;
      }
      this.flow = true;
      
      this.eventDispatcher.notify("onQueueStart");
      
      this.next();
    },

    end: function()
    {
      this.blobs = [];
      this.flow  = false;

      this.eventDispatcher.notify("onQueueEnd");
    },

    busy: function()
    {
      return this.flow === true;
    },

    next: function()
    {
      var blob = this.curblob = this.blobs.shift();

      console.log('AjaxQueue.next(%o)', blob);

      if (typeof(blob) === "undefined")
      {
        this.end();
        return;
      }

      this.send(blob);
    },

    /**
     * Sends or resends (in case of reconnect) the current element in
     * the ajax queue.
     *
     * @param {Object} blob   Cf. add()
     */
    send: function(blob)
    {
      console.log('AjaxQueue.send(%o)', blob);

      this.ajaxRequest = new Core.Ui.AjaxRequest(blob.url, blob.options);
    },

    /**
     * YUI Connect custom event.
     * 
     * @param {String} eventType
     * @param {Object} args
     */
    onAjaxStart: function(eventType, args)
    {
      Dom.setStyles(this.ajaxIndicator, {
        position: 'absolute',
        zIndex:   1000,
        display:  'block'
      });
    },

    /**
     * YUI Connect custom event.
     * 
     * @param {String} eventType
     * @param {Object} args
     */
    onAjaxComplete: function(eventType, args)
    {
      Dom.setStyles(this.ajaxIndicator, {
        display:  'none'
      });
    },

    /**
     * 
     * @param {Object} o   YUI Connect response object, augmented by AjaxRequest (responseJSON, ...)
     */
    onAjaxSuccess: function(o)
    {
      console.log('AjaxQueue::onAjaxSuccess(%o)', o);

      // success notification
      var args = ['onSuccess', o];
      if (!Y.lang.isUndefined(this.curblob.options.argument))
      {
        args.push(this.curblob.options.argument);
      }
      this.eventDispatcher.notify.apply(this.eventDispatcher, args);

      this.next();
    },

    /**
     * 
     * 
     * @param {Object} o   YUI Connect response object, augmented by AjaxRequest (responseJSON, ...)
     */
    onAjaxFailure: function(o)
    {
      console.log('AjaxQueue::onAjaxFailure(%o)', o);

      var sErrorMessage = this.ajaxRequest.getHttpHeader(o, 'RTK-Error');

      this.ajaxRequest = null;

      if (o.status === -1)
      {
        // show the timeout message
        this.setErrorDialog('Oops! Connection timed out.');
        return;
      }

      if (sErrorMessage !== null)
      {
        //alert('Oops! The server returned an error: "'+sErr500Message+'"');

        // show neat message from custom server-side ajax exception
        this.setErrorDialog(sErrorMessage);
      }
      else
      {
        sErrorMessage = o.status + ' ' + o.statusText;
        alert('Oops! The server returned a "'+sErrorMessage+'" error.');
      }
    },

    /**
     * Called when clicking link in the elAjaxError dialog. 
     * 
     * Retry the last message and resume the queue.
     */
    reconnectEvent: function(ev)
    {
      this.setErrorDialog(false);
      this.send(this.curblob);
      Event.stopEvent(ev);
    },

    /**
     * Show or hide the Ajax error message.
     * 
     * @param {string|boolean} sErrorMessage    String or false to hide the message.
     */
    setErrorDialog: function(sErrorMessage)
    {
      if (sErrorMessage)
      {
        var el = Dom.down(this.elAjaxError, 'uiFcAjaxError_msg');
        el.innerHTML = sErrorMessage;
      }

      Dom.toggle(this.elAjaxError, !!sErrorMessage);
    }
  };

export { AjaxQueue }
