import * as CBuffer from 'CBuffer';
import { EventEmitter} from 'events';
import * as nats from 'node-nats-streaming';
import { IBufferItem, IBufferStore } from './buffer-store';

export { IBufferItem, IBufferStore } from './buffer-store';
export { SqliteBufferStore } from './sqlite-buffer-store';

/**
 * Console-compatible logger contract
 *
 * @export
 * @interface ILogger
 */
export interface ILogger
{
  debug?: ( message?: any, ...optionalParams: any[] ) => void;
  log: ( message?: any, ...optionalParams: any[] ) => void;
  warn: ( message?: any, ...optionalParams: any[] ) => void;
  error: ( message?: any, ...optionalParams: any[] ) => void;
}

/**
 * Construction options for the buffered client
 *
 * @export
 * @interface INatsBufferedClientOptions
 */
export interface INatsBufferedClientOptions
{
  /**
   * Size of the publish buffer. Default 10
   */
  bufferSize?: number;

  /**
   * When true publishing before the initial connect throws. Default false
   */
  waitForInitialConnection?: boolean;

  /**
   * Console-compatible logger. Default console
   */
  logger?: ILogger;

  /**
   * Retry delay in milliseconds when a forced reconnect fails. Default 5000
   */
  reconnectDelay?: number;

  /**
   * Amount of items to publish per tick. Default 10
   */
  batchSize?: number;

  /**
   * Optional persistent store. When provided every accepted message is
   * durably written before publish() resolves and restored on connect()
   * after a restart
   */
  store?: IBufferStore;
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
   * Size of our publish buffer
   *
   * @private
   * @memberof NatsBufferedClient
   */
  private bufferSize: number;

  /**
   * Allows publishing to the buffer before initial connect
   *
   * @private
   * @memberof NatsBufferedClient
   */
  private waitForInitialConnection: boolean;

  /**
   * If reconnect fails retry after this amount of time
   *
   * @private
   * @memberof NatsBufferedClient
   */
  private reconnectDelay: number;

  /**
   * Amount of items to publish in 1 tick
   *
   * @private
   * @memberof NatsBufferedClient
   */
  private batchSize: number;

  /**
   * Optional persistent message store
   *
   * @private
   * @memberof NatsBufferedClient
   */
  private store?: IBufferStore;

  /**
   * Indicator we've reached a connected state at least once with the current stan instance
   *
   * @private
   * @memberof NatsBufferedClient
   */
  private initialConnected = false;

  /**
   * Indicator we've reached a hydrated state at least once with the
   * current process. In-flight hydration is tracked by hydratePromise
   *
   * @private
   * @memberof NatsBufferedClient
   */
  private hydrated = false;

  /**
   * Caches the in-flight hydration promise so concurrent connect() calls
   * share one loadAll() instead of each racing their own, which would
   * duplicate every stored message into the buffer
   *
   * @private
   * @memberof NatsBufferedClient
   */
  private hydratePromise: Promise<void> | undefined;

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
   * @param {INatsBufferedClientOptions} [options={}] Construction options for the buffered client
   * @memberof NatsBufferedClient
   */
  constructor( options: INatsBufferedClientOptions = {} )
  {
    // Initialise the event emitter super class
    //
    super();

    // Apply options with their defaults
    //
    this.bufferSize               = options.bufferSize !== undefined ? options.bufferSize : 10;
    this.waitForInitialConnection = options.waitForInitialConnection === true;
    this.reconnectDelay           = options.reconnectDelay !== undefined ? options.reconnectDelay : 5000;
    this.batchSize                = options.batchSize !== undefined ? options.batchSize : 10;
    this.store                    = options.store;

    const logger: ILogger = options.logger || console;

    // Build our logger
    //
    this.logger = {
      debug: ( message?: any, ...optionalParams: any[] ) => ( logger.debug || logger.log ).apply( logger, [ message, optionalParams ] ),
      log: ( message?: any, ...optionalParams: any[] ) => logger.log.apply( logger, [ message, optionalParams ] ),
      warn:  ( message?: any, ...optionalParams: any[] ) => logger.warn.apply( logger, [ message, optionalParams ] ),
      error: ( message?: any, ...optionalParams: any[] ) => logger.error.apply( logger, [ message, optionalParams ] ),
    };

    this.logger.log( '[NATS-BUFFERED-CLIENT] Constructing...' );
    this.logger.log( '[NATS-BUFFERED-CLIENT] Buffer size', this.bufferSize );
    this.logger.log( '[NATS-BUFFERED-CLIENT] Batch size', this.batchSize );

    // Initialize our ring buffer with the requested size
    //
    this.buffer          = new CBuffer( this.bufferSize );
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
  public async connect(
    clusterId: string,
    clientId: string,
    options?: nats.StanOptions ): Promise<boolean>
  {
    // Restore persisted messages before anything else. A configured but
    // unreadable store rejects the connect: failing loud beats silently
    // stranding messages. reconnect() retries failed connects on a timer
    //
    await this.hydrate();

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
   * Push an item into the buffer to publish it. When a persistent store
   * is configured the item is durably written before this resolves:
   * resolved means durably buffered, rejected means not accepted
   *
   * @param {string} subject
   * @param {*} data
   * @returns {Promise<number>} The buffer length after adding the message
   * @memberof NatsBufferedClient
   */
  public async publish( subject: string, data: any ): Promise<number>
  {
    // Don't allow publishing before initial connect if the client is
    // configured to do so
    //
    if ( this.waitForInitialConnection && !this.initialConnected )
    {
      throw new Error( 'Tried to publish before initial connection' );
    }

    const item: IBufferItem = { subject, data };

    // Write through to the persistent store first. A rejected add
    // rejects this publish and the message is NOT buffered
    //
    if ( this.store )
    {
      item.id = await this.store.add( item );
    }

    // Push onto the end of the buffer
    //
    this.buffer.push( item );
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
   * Handle buffer overflows. Default behaviour is to log the drop and
   * mirror it to the persistent store when one is configured.
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

    // Keep the store identical to the buffer contents
    //
    this.removeFromStore( data as IBufferItem );
  }

  /**
   * Load persisted messages from the store into the buffer. Called at
   * the start of connect(). Safe to call concurrently: overlapping calls
   * share the same underlying load
   *
   * @protected
   * @returns {Promise<void>}
   * @memberof NatsBufferedClient
   */
  protected hydrate(): Promise<void>
  {
    if ( !this.store || this.hydrated )
    {
      return Promise.resolve();
    }

    if ( !this.hydratePromise )
    {
      this.hydratePromise = this.doHydrate()
      .catch( ( error ) =>
      {
        // Allow a later connect() to retry after a failed hydration
        //
        this.hydratePromise = undefined;
        throw error;
      } );
    }

    return this.hydratePromise;
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
      // Shift the batch off the front of the buffer one item at a time.
      // NOTE: CBuffer.slice() returns a plain Array so reassigning
      // this.buffer from it would silently discard the ring buffer and
      // its overflow handling
      //
      const batchItems: IBufferItem[] = [];
      while ( batchItems.length < this.batchSize && this.buffer.length > 0 )
      {
        batchItems.push( this.buffer.shift() );
      }

      if ( !batchItems.length ) {
        this.logger.log( '[NATS-BUFFERED-CLIENT] Buffer is empty. Going to sleep' );
        this.ticking = false;
      } else {

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

            // The message reached NATS so it leaves the store
            //
            this.removeFromStore( pub );
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
   * Performs the actual hydration: loads persisted messages, dedups them
   * against items already in the buffer by id, and rebuilds the buffer
   * with hydrated items first, evicting beyond capacity via overflow().
   * Items already in the buffer (published before connect) are skipped
   * by id; loaded items are older than anything published this session
   * so they go in front.
   *
   * NOTE: the buffer is rebuilt instead of unshifted because CBuffer
   * evicts the NEWEST items when unshifting into a full buffer while
   * we want to drop the oldest beyond capacity
   *
   * @private
   * @returns {Promise<void>}
   * @memberof NatsBufferedClient
   */
  private async doHydrate(): Promise<void>
  {
    const stored = await this.store!.loadAll();
    this.hydrated = true;

    // Collect the ids already in the memory buffer
    //
    const current: IBufferItem[] = this.buffer.toArray();
    const currentIds             = new Set<number>();
    current.forEach( ( item ) =>
    {
      if ( item.id !== undefined )
      {
        currentIds.add( item.id );
      }
    } );

    // Exact id-based dedup of messages published before connect
    //
    const fresh = stored.filter( ( item ) => item.id === undefined || !currentIds.has( item.id ) );

    // Rebuild: hydrated items in front, oldest beyond capacity dropped
    // through the normal overflow path so the store stays in sync
    //
    const combined = fresh.concat( current );
    const excess   = combined.length - this.bufferSize;
    if ( excess > 0 )
    {
      combined.splice( 0, excess ).forEach( ( dropped ) => this.overflow( dropped ) );
    }

    this.buffer.empty();
    combined.forEach( ( item ) => this.buffer.push( item ) );

    this.logger.log( `[NATS-BUFFERED-CLIENT] Hydrated ${fresh.length} stored message(s)` );
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

  /**
   * Fire-and-forget removal of an item from the persistent store.
   * Failure is logged and swallowed: at worst the message is republished
   * after a restart which is acceptable since NATS streaming is
   * at-least-once
   *
   * @private
   * @param {IBufferItem} item
   * @memberof NatsBufferedClient
   */
  private removeFromStore( item: IBufferItem ): void
  {
    if ( this.store && item.id !== undefined )
    {
      this.store.remove( item.id )
      .catch( ( error ) =>
      {
        this.logger.error( '[NATS-BUFFERED-CLIENT] Failed to remove item from store', item.id, error );
      } );
    }
  }
}
