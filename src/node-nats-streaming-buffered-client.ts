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
   * Indicator we've reached a connected state with the current stan instance
   *
   * @private
   * @memberof NatsBufferedClient
   */
  private clientConnected = false;

  /**
   * The reconnect timer
   *
   * @private
   * @type {NodeJS.Timer}
   * @memberof NatsBufferedClient
   */
  private reconnectTimer!: NodeJS.Timer;

  /**
   * The getter for the client connection state
   *
   * @readonly
   * @memberof NatsBufferedClient
   */
  public get connected()
  {
    return this.clientConnected;
  }

  /**
   * The setter for the client connection state
   * Will stop or reset the client reconnect timer
   *
   * @memberof NatsBufferedClient
   */
  public set connected( newConnectedState: boolean )
  {
    this.clientConnected = newConnectedState;
    console.log( '[NATS-BUFFERED-CLIENT] Client connected status', this.clientConnected );

    // This timer will try to reconnect to the server on prolonged absence
    //
    clearInterval( this.reconnectTimer );
    if ( !this.clientConnected )
    {
      console.log( '[NATS-BUFFERED-CLIENT] Starting reconnect timer', this.reconnectTimeout );

      this.reconnectTimer = setInterval( () =>
      {
        console.log( '[NATS-BUFFERED-CLIENT] Timer triggered reconnect...' );
        this.reconnect();
      }, this.reconnectTimeout );
    }
  }

  /**
   * Creates an instance of NatsBufferedClient
   *
   * @param {Stan} stan The NATS connection
   * @param {number} [bufferSize=10] The ring buffer size
   * @memberof NatsBufferedClient
   */
  constructor( bufferSize: number = 10, private reconnectTimeout = 30000 )
  {
    // Initialize our ring buffer with the requested size
    //
    this.buffer = new CBuffer( bufferSize );
    this.buffer.overflow = ( data: any ) => this.overflow( data );

    // Close NATS server connection on exit
    //
    process.on( 'exit', async () =>
    {
      console.log( '[NATS-BUFFERED-CLIENT] EXIT encountered' );
      try
      {
        await this.disconnect();
        console.log( '[NATS-BUFFERED-CLIENT] Disconnected due to EXIT' );
      }
      catch ( error )
      {
        console.error( '[NATS-BUFFERED-CLIENT] Error during EXIT disconnect', error );
      }
    } );

    // Close NATS server connection on interupt
    //
    process.on( 'SIGINT', async () =>
    {
      console.log( '[NATS-BUFFERED-CLIENT] SIGINT encountered' );

      // Stop any pending reconnect timers
      //
      clearInterval( this.reconnectTimer );

      try
      {
        await this.disconnect();
        console.log( '[NATS-BUFFERED-CLIENT] Disconnected due to SIGINT' );
        process.exit();
      }
      catch ( error )
      {
        console.error( '[NATS-BUFFERED-CLIENT] Error during SIGINT disconnect', error );
        process.exit();
      }
    } );
  }

  /**
   * Connect to the NATS server
   *
   * @memberof NatsBufferedClient
   */
  public async connect( clusterId: string, clientId: string, options?: nats.StanOptions )
  {
    // Disconnect any previous connection (attempt)
    //
    try
    {
      await this.disconnect();
    }
    catch ( error )
    {
      console.error( '[NATS-BUFFERED-CLIENT] Error during disconnect', error );
    }

    // Reset connected state
    //
    this.connected = false;
    this.stan      = undefined;

    // Connect to NATS server
    //
    console.log( '[NATS-BUFFERED-CLIENT] Connecting...' );
    this.stan = nats.connect( clusterId, clientId, options );

    // Store connection parameters
    //
    this.clusterId     = clusterId;
    this.clientId      = clientId;
    this.clientOptions = options;

    // Listen for connect events
    //
    this.stan.on( 'connect', () =>
    {
      console.log( '[NATS-BUFFERED-CLIENT] Connected' );
      this.connected = true;

      // Start processing the buffer
      //
      this.tick();
    } );

    this.stan.on( 'error', ( error ) =>
    {
      console.error( '[NATS-BUFFERED-CLIENT] Server error', error );
    } );

    this.stan.on( 'reconnecting', () =>
    {
      console.log( '[NATS-BUFFERED-CLIENT] Reconnecting' );
    } );

    this.stan.on( 'reconnect', () =>
    {
      console.log( '[NATS-BUFFERED-CLIENT] Reconnected' );
    } );

    this.stan.on( 'disconnect', () =>
    {
      console.log( '[NATS-BUFFERED-CLIENT] Disconnected' );
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
      if ( this.stan && this.connected )
      {
        const currentConnection = this.stan;
        currentConnection.on( 'disconnect', resolve );
        currentConnection.on( 'error',      reject  );
        currentConnection.close();

        this.connected = false;
        this.stan      = undefined;
      }
      else
      {
        // Not connected
        //
        console.log( '[NATS-BUFFERED-CLIENT] Not connected so no need to disconnect', this.connected, this.stan === undefined );
        resolve();
      }
  } );
  }

  /**
   * Try to reconnect to the NATS server using our stored settings
   *
   * @memberof NatsBufferedClient
   */
  public reconnect()
  {
    console.log( '[NATS-BUFFERED-CLIENT] Reconnecting...' );
    this.connect( this.clusterId, this.clientId, this.clientOptions );
  }

  /**
   * Push an item into the buffer to publish it
   *
   * @param {string} subject
   * @param {*} data
   * @memberof NatsBufferedClient
   */
  public publish( subject: string, data: any ): number
  {
    // Push onto the end of the buffer
    //
    this.buffer.push( { subject, data } as IBufferItem );
    console.log( '[NATS-BUFFERED-CLIENT] Added message to buffer', subject, data );

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
    console.log( '[NATS-BUFFERED-CLIENT] Buffer is full. Dropping data:', data );
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
        this.stan.publish( pub.subject, JSON.stringify( pub.data ), ( error ) =>
        {
          if ( error )
          {
            console.error( '[NATS-BUFFERED-CLIENT] Publish failed', error );
            this.buffer.unshift( pub );

            // Reconnect to the server on publish error
            //
            console.warn( '[NATS-BUFFERED-CLIENT] Reconnect to server due to publish error' );
            this.reconnect();
          }
          else
          {
            console.log( '[NATS-BUFFERED-CLIENT] Publish done', pub );

            // If we can publish we are connected
            //
            this.connected = true;

            // Next!
            //
            this.tick();
          }
        } );
      }
      else
      {
        console.log( '[NATS-BUFFERED-CLIENT] Buffer is empty. Going to sleep' );
        this.ticking = false;
      }
    }
    else
    {
      console.warn( '[NATS-BUFFERED-CLIENT] Buffer tick called when not connected' );
      this.ticking = false;
    }
  }
}
