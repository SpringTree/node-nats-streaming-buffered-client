import * as CBuffer from 'CBuffer';
import { EventEmitter} from 'events';
import * as nats from 'node-nats-streaming';

/**
 * The type of objects we push onto our buffer
 *
 * @interface IBufferItem
 */
interface IBufferItem
{
  subject: string;
  data: any;
}

/**
 * The buffered NATS client class
 *
 * @export
 * @class NatsBufferedClient
 */
export class NatsBufferedClient extends EventEmitter
{
  /**
   * The connection to the NATS server
   *
   * @private
   * @type {Stan}
   * @memberof NatsBufferedClient
   */
  public stan: nats.Stan | undefined;

  /**
   * Our ring buffer instance
   *
   * @private
   * @type {*}
   * @memberof NatsBufferedClient
   */
  private buffer: any;

  /**
   * The name of the cluster we're connecting to
   *
   * @private
   * @type {string}
   * @memberof NatsBufferedClient
   */
  private clusterId!: string;

  /**
   * Our client identifier to use when connecting
   *
   * @private
   * @type {string}
   * @memberof NatsBufferedClient
   */
  private clientId!: string;

  /**
   * The NATS connection options to use
   *
   * @private
   * @type {(StanOptions|undefined)}
   * @memberof NatsBufferedClient
   */
  private clientOptions: nats.StanOptions|undefined;

  /**
   * Indicates if we're processing the buffer
   *
   * @private
   * @memberof NatsBufferedClient
   */
  private ticking = false;

  /**
   * Indicator we've reached a connected state at least once with the current stan instance
   *
   * @private
   * @memberof NatsBufferedClient
   */
  private initialConnected = false;

  /**
   * Logging wrapper
   *
   * @private
   * @memberof NatsBufferedClient
   */
  private logger: {
    debug: ( message?: any, ...optionalParams: any[] ) => void;
    log: ( message?: any, ...optionalParams: any[] ) => void;
    warn: ( message?: any, ...optionalParams: any[] ) => void;
    error: ( message?: any, ...optionalParams: any[] ) => void;
  };

  /**
   * Creates an instance of NatsBufferedClient
   *
   * @param {number} [bufferSize=10] Size of our publish buffer
   * @param {boolean} [waitForInitialConnection=false] Allows publishing to the buffer before initial connect
   * @param {*} [logger=console] The console logger to use
   * @param {number} [reconnectDelay=5000] If reconnect fails retry after this amount of time. Default is 5 seconds
   * @param {number} [batchSize=10] Amount of items to publish in 1 tick
   * @memberof NatsBufferedClient
   */
  constructor(
    private bufferSize: number = 10,
    private waitForInitialConnection = false,
    logger = console,
    private reconnectDelay = 5000,
    private batchSize = 10,
  )
  {
    // Initialise the event emitter super class
    //
    super();

    // Build our logger
    //
    this.logger = {
      debug: ( message?: any, ...optionalParams: any[] ) => (logger.debug || logger.log).apply( logger, [ message, optionalParams ] ),
      log: ( message?: any, ...optionalParams: any[] ) => (logger.log || logger.debug).apply( logger, [ message, optionalParams ] ),
      warn:  ( message?: any, ...optionalParams: any[] ) => logger.warn.apply( logger, [ message, optionalParams ] ),
      error: ( message?: any, ...optionalParams: any[] ) => logger.error.apply( logger, [ message, optionalParams ] ),
    };

    this.logger.log( '[NATS-BUFFERED-CLIENT] Constructing...' );
    this.logger.log( '[NATS-BUFFERED-CLIENT] Buffer size', this.bufferSize );
    this.logger.log( '[NATS-BUFFERED-CLIENT] Batch size', this.batchSize );

    // Initialize our ring buffer with the requested size
    //
    this.buffer = new CBuffer( bufferSize );
    this.buffer.overflow = ( data: any ) => this.overflow( data );

    // Close NATS server connection on exit
    //
    process.on( 'exit', async () =>
    {
      this.logger.log( '[NATS-BUFFERED-CLIENT] EXIT encountered' );
    } );

    // Close NATS server connection on interupt
    //
    process.on( 'SIGINT', async () =>
    {
      this.logger.log( '[NATS-BUFFERED-CLIENT] SIGINT encountered' );

      try
      {
        if ( this.stan ) {

          this.logger.log( '[NATS-BUFFERED-CLIENT] Disconnected due to SIGINT' );
          this.disconnect();
        }
      }
      catch ( error )
      {
        this.logger.error( '[NATS-BUFFERED-CLIENT] Error during SIGINT disconnect', error );
      }
    } );
  }

  /**
   * Connect to the NATS server
   *
   * @param {string} clusterId The name of the nats cluster
   * @param {string} clientId The client identifier to use
   * @param {nats.StanOptions} [options] Streaming connection options. Will be amended with out defaults
   * @returns {Promise<boolean>}
   * @memberof NatsBufferedClient
   */
  public connect(
    clusterId: string,
    clientId: string,
    options?: nats.StanOptions ): Promise<boolean>
  {
    return new Promise( ( resolve, reject ) =>
    {
      // Store connection parameters
      // Apply default options for recommended reconnect logic
      //
      this.clusterId       = clusterId;
      this.clientId        = clientId;
      const defaultOptions = {
        maxReconnectAttempts: -1,
        reconnect: true,
        waitOnFirstConnect: true,
      };
      this.clientOptions = Object.assign( defaultOptions, options );

      // Connect to NATS server
      //
      this.logger.log( '[NATS-BUFFERED-CLIENT] Connecting...', clusterId, clientId, this.clientOptions );
      this.stan = nats.connect( clusterId, clientId, this.clientOptions );

      // Listen for connect events
      //
      this.stan.on( 'connect', () =>
      {
        this.logger.log( '[NATS-BUFFERED-CLIENT] Connected' );
        this.initialConnected = true;

        // Start processing the buffer
        //
        this.logger.log( '[NATS-BUFFERED-CLIENT] Start buffer processing...' );
        this.tick();

        // Resolve initial connection promise
        //
        resolve( true );
      } );

      this.stan.on( 'connection_lost', ( error ) =>
      {
        this.logger.log( '[NATS-BUFFERED-CLIENT] Connection was lost to server', error );
      } );

      this.stan.on( 'error', ( error ) =>
      {
        this.logger.error( '[NATS-BUFFERED-CLIENT] Server error', error );

        // Reject initial connection promise
        //
        if ( !this.initialConnected ) {
          reject( error );
        }
      } );

      this.stan.on( 'reconnecting', () =>
      {
        this.logger.log( '[NATS-BUFFERED-CLIENT] Reconnecting' );
      } );

      this.stan.on( 'reconnect', ( stan ) =>
      {
        this.logger.log( '[NATS-BUFFERED-CLIENT] Reconnected', stan === this.stan );

        // Resume processing the buffer
        //
        // this.logger.log( '[NATS-BUFFERED-CLIENT] Resuming buffer processing...' );
        // this.tick();
      } );

      this.stan.on( 'disconnect', () =>
      {
        this.logger.log( '[NATS-BUFFERED-CLIENT] Disconnected' );
      } );

      this.stan.on( 'close', () =>
      {
        this.logger.log( '[NATS-BUFFERED-CLIENT] Closed connection' );
      } );

      this.stan.on( 'permission_error', (error) =>
      {
        this.logger.log( '[NATS-BUFFERED-CLIENT] Permission error', error );
      } );
    } );
  }

  /**
   * Closes the current NATS server connection
   *
   * @returns {Promise<any>}
   * @memberof NatsBufferedClient
   */
  public disconnect(): Promise<any>
  {
    return new Promise( ( resolve, reject ) =>
    {
      // Only disconnect when stan client has been created and
      // if connect has been seen.
      // If you call stan.close() when not connected an error will be thrown
      //
      if ( this.stan )
      {
        const currentConnection = this.stan;
        currentConnection.on( 'close', resolve );
        currentConnection.on( 'error', reject  );
        currentConnection.close();

        this.stan = undefined;
      }
      else
      {
        // Not connected
        //
        this.logger.debug( '[NATS-BUFFERED-CLIENT] Not connected so no need to disconnect', this.stan === undefined );
        resolve();
      }
    } );
  }

  /**
   * Try to reconnect to the NATS server using our stored settings
   *
   * @memberof NatsBufferedClient
   * @fires forced_reconnecting Event signalling a forced reconnect is starting
   * @fires forced_disconnected Event signalling forced disconnect completed
   * @fires forced_reconnected Event signalling forced reconnect completed
   */
  public async reconnect()
  {
    // Emit a signal that we're starting a hard reconnect
    //
    this.emit( 'forced_reconnecting' );

    // First close existing connection if still available
    //
    this.logger.log( '[NATS-BUFFERED-CLIENT] Reconnect requested. Disconnecting...' );
    try {
      await this.disconnect();
    } catch ( disconnectError ) {
      this.logger.warn( '[NATS-BUFFERED-CLIENT] Error during disconnect', disconnectError );
    }

    // Emit a signal that we've completed a hard disconnect
    //
    this.emit( 'forced_disconnected' );

    // Create a new connection
    //
    this.logger.log( '[NATS-BUFFERED-CLIENT] Disconnected trying to connect again...' );
    try {
      await this.connect( this.clusterId, this.clientId, this.clientOptions );
    } catch ( connectError ) {
      this.logger.warn( '[NATS-BUFFERED-CLIENT] Error during connect. Retry in 5 seconds', connectError );
      setTimeout( () => this.reconnect(), this.reconnectDelay );
    }

    this.logger.log( '[NATS-BUFFERED-CLIENT] Reconnect completed' );

    // Emit a signal that we've completed a hard reconnect
    //
    this.emit( 'forced_reconnected', this.stan );

    return this.stan;
  }

  /**
   * Push an item into the buffer to publish it
   *
   * @param {string} subject
   * @param {string} data
   * @memberof NatsBufferedClient
   */
  public publish( subject: string, data: string ): number
  {
    // Don't allow publishing before initial connect if the client is
    // configured to do so
    //
    if ( this.waitForInitialConnection && !this.initialConnected ) {
      throw new Error( 'Tried to publish before initial connection' );
    }

    // Push onto the end of the buffer
    //
    this.buffer.push( { subject, data } as IBufferItem );
    this.logger.log( '[NATS-BUFFERED-CLIENT] Added message to buffer', subject, data );

    // Resume buffer processing if needed
    //
    if ( this.stan && !this.ticking )
    {
      this.tick();
    }

    return this.buffer.length;
  }

  /**
   * Returns the current amount of items in the buffer
   *
   * @returns
   * @memberof NatsBufferedClient
   */
  public count() {
    return this.buffer.length;
  }

  /**
   * Current buffer utilisation as a percentage (0-100)
   *
   * @returns
   * @memberof NatsBufferedClient
   */
  public utilisation() {
    return this.buffer.length * 100 / this.bufferSize;
  }

  /**
   * Handle buffer overflows. Default behaviour is to log
   * This method is protected to allow extending classes to implement
   * alternate handling like persisting or logging to disk
   *
   * @protected
   * @param {*} data
   * @memberof NatsBufferedClient
   */
  protected overflow( data: any )
  {
    // Log when buffer overflows
    //
    this.logger.log( '[NATS-BUFFERED-CLIENT] Buffer is full. Dropping data:', data );
  }

  /**
   * Process the buffer content
   *
   * @protected
   * @memberof NatsBufferedClient
   */
  protected tick()
  {
    // Indicate we're actively processing the buffer
    //
    this.ticking = true;

    if ( this.stan )
    {
      const batchItems: IBufferItem[] = this.buffer.slice( 0, this.batchSize );
      if ( !batchItems.length ) {
        this.logger.log( '[NATS-BUFFERED-CLIENT] Buffer is empty. Going to sleep' );
        this.ticking = false;
      } else {

        // Take the batch out of the buffer
        // We will push back error items if needed
        //
        this.buffer = this.buffer.slice( this.batchSize );

        // Collect publish promises for the entire batch
        //
        const publishBatch: Array<Promise<IBufferItem>> = [];

        // Use a for each to create a function scope so can remember which
        // pub item fails
        //
        batchItems.forEach( ( pub ) => {
          const publishItem = this.stanPublish( this.stan as nats.Stan, pub );
          publishBatch.push( publishItem );

          publishItem
          .then( () => {
            this.logger.log( '[NATS-BUFFERED-CLIENT] Publish done', pub );
          } )
          .catch( ( error ) => {
            this.logger.error( '[NATS-BUFFERED-CLIENT] Publish failed', pub, error );
            this.logger.error( '[NATS-BUFFERED-CLIENT] Publish error', error );

            // Push the item back onto the buffer
            //
            this.buffer.unshift( pub );
          } );
        } );

        Promise.all( publishBatch )
        .then( () => {
          this.logger.log( `[NATS-BUFFERED-CLIENT] Buffer utilisation ${Math.round( this.utilisation() )}%`, this.count() );

          // Next buffer item batch
          //
          this.tick();
        } )
        .catch( ( error ) => {
          this.logger.error( '[NATS-BUFFERED-CLIENT] Error type', typeof error );
          this.logger.log( `[NATS-BUFFERED-CLIENT] Buffer utilisation ${Math.round( this.utilisation() )}%`, this.count() );

          // Try to retrieve the actual error message
          // Errors thrown in the client are normal JS Error objects
          // Errors returned from the server appear to be strings
          //
          let errorMessage;
          try {
            errorMessage = typeof error === 'string' ? error : error.message;
          } catch ( unknownErrorTypeError ) {
            this.logger.warn( '[NATS-BUFFERED-CLIENT] Failed to interpret error type', error );
          }

          if ( errorMessage === 'stan: publish ack timeout') {
            this.logger.warn( '[NATS-BUFFERED-CLIENT] Publish time-out detected', error );
          }

          // A long term disconnect can trigger a bigger issue
          // The NATS connection might reconnect/resume but the streaming server
          // may have lost your client id or considers it dead due to missing heartbeats
          // An error called 'stan: invalid publish request' will occur in this case
          // If that happens we will manually reconnect to try and restore communication
          //
          // NOTE: Be cautious about reconnecting. If subscriptions are not closed you
          //       end up with a client id already registered error
          //
          if ( errorMessage === 'stan: invalid publish request') {
            this.reconnect()
            .then( () => {
              this.logger.warn( '[NATS-BUFFERED-CLIENT] Completed forced reconnect due to client de-sync', error );
              this.tick();
            })
            .catch( ( reconnectError ) => {
              this.logger.error( '[NATS-BUFFERED-CLIENT] Reconnect failed', reconnectError );
              this.tick();
            });
          } else {
            // Next buffer item or retry
            //
            this.tick();
          }
        } );
      }
    }
    else
    {
      this.logger.warn( '[NATS-BUFFERED-CLIENT] Buffer tick called when not connected' );
      this.ticking = false;
    }
  }

  /**
   * Publish item to stan using a promise
   *
   * @private
   * @param {nats.Stan} stan
   * @param {IBufferItem} pub
   * @returns {Promise<string>}
   * @memberof NatsBufferedClient
   */
  private stanPublish( stan: nats.Stan, pub: IBufferItem ): Promise<IBufferItem> {

    return new Promise( ( resolve, reject ) => {
      stan.publish( pub.subject, pub.data, ( error: Error|undefined ) =>
      {
        if ( error )
        {
          reject( error );
        }
        else
        {
          resolve( pub );
        }
      } );
    } );
  }
}
