import * as CBuffer from 'CBuffer';
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
export class NatsBufferedClient
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
   * @memberof NatsBufferedClient
   */
  constructor(
    bufferSize: number = 10,
    private waitForInitialConnection = false,
    logger = console )
  {
    // Build our logger
    //
    this.logger = {
      debug: logger.debug || logger.log,
      log: logger.log || logger.debug,
      warn: logger.warn,
      error: logger.error,
    };

    this.logger.log( '[NATS-BUFFERED-CLIENT] Constructing...' );

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
        currentConnection.on( 'disconnect', resolve );
        currentConnection.on( 'error',      reject  );
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
   */
  public async reconnect()
  {
    // First close existing connection if still available
    //
    this.logger.log( '[NATS-BUFFERED-CLIENT] Reconnect requested. Disconnecting...' );
    await this.disconnect();

    // Create a new connection
    //
    this.logger.log( '[NATS-BUFFERED-CLIENT] Disconnected trying to connect again...' );
    await this.connect( this.clusterId, this.clientId, this.clientOptions );

    this.logger.log( '[NATS-BUFFERED-CLIENT] Reconnect completed' );
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
      const pub: IBufferItem | undefined = this.buffer.shift();
      if ( pub )
      {
        this.stan.publish( pub.subject, pub.data, ( error ) =>
        {
          if ( error )
          {
            this.logger.error( '[NATS-BUFFERED-CLIENT] Publish failed', error );

            // Push the item back onto the buffer
            //
            this.buffer.unshift( pub );

            // Trigger a reconnect to reset the connection and begin processing again
            //
            // this.reconnect();
          }
          else
          {
            this.logger.log( '[NATS-BUFFERED-CLIENT] Publish done', pub );
          }

          // Next buffer item or retry that last one
          //
          this.tick();
        } );
      }
      else
      {
        this.logger.log( '[NATS-BUFFERED-CLIENT] Buffer is empty. Going to sleep' );
        this.ticking = false;
      }
    }
    else
    {
      this.logger.warn( '[NATS-BUFFERED-CLIENT] Buffer tick called when not connected' );
      this.ticking = false;
    }
  }
}
