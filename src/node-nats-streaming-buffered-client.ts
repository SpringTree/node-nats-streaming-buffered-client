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
   * Our publish failure count
   *
   * @private
   * @type {0}
   * @memberof NatsBufferedClient
   */
  private publishFailCount = 0;

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
  private connected = false;

  /**
   * Our primary connection timer
   *
   * @private
   * @type {NodeJS.Timer}
   * @memberof NatsBufferedClient
   */
  private connectTimer!: NodeJS.Timer;

  /**
   * Our publish retry timer
   *
   * @private
   * @type {NodeJS.Timer}
   * @memberof NatsBufferedClient
   */
  private republishTimer!: NodeJS.Timer;

  /**
   * The connection to the NATS server
   *
   * @private
   * @type {Stan}
   * @memberof NatsBufferedClient
   */
  public stan: nats.Stan | undefined;

  /**
   * Creates an instance of NatsBufferedClient
   *
   * @param {Stan} stan The NATS connection
   * @param {number} [bufferSize=10] The ring buffer size
   * @param {number} [connectTimeout=30000] Connection timeout in milliseconds
   * @memberof NatsBufferedClient
   */
  constructor( bufferSize: number = 10, private connectTimeout = 30000 )
  {
    // Initialize our ring buffer with the requested size
    //
    this.buffer = new CBuffer( bufferSize );
    this.buffer.overflow = ( data: any ) => this.overflow( data );

    // Close NATS server connection on exit
    //
    process.on( 'exit', () =>
    {
      if ( this.stan )
      {
        console.log( '[NATS-BUFFERED-CLIENT] Disconnecting due to exit' );
        this.disconnect().then( () => console.log( '[NATS-BUFFERED-CLIENT] Disconnected due to exit' ) );
      }
    } );

    // Close NATS server connection on interupt
    //
    process.on( 'SIGINT', () =>
    {
      console.log( '[NATS-BUFFERED-CLIENT] Disconnecting due to SIGINT' );
      this.disconnect().then( () => console.log( '[NATS-BUFFERED-CLIENT] Disconnected due to SIGINT' ) );
    } );
  }

  /**
   * Connect to the NATS server
   *
   * @memberof NatsBufferedClient
   */
  public async connect( clusterId: string, clientId: string, options?: nats.StanOptions )
  {
    // Disconnect any previous connection
    //
    await this.disconnect();

    // Connect to NATS server
    //
    this.stan = nats.connect( clusterId, clientId, options );

    // Store connection parameters
    //
    this.clusterId     = clusterId;
    this.clientId      = clientId;
    this.clientOptions = options;

    // Start a timer for a connection timeout
    //
    this.connectTimer = setTimeout( () =>
    {
      console.warn( `[NATS-BUFFERED-CLIENT] Failed to connect within our timeout` );
      this.reconnect();
    }, this.connectTimeout )

    // Listen for connect events
    //
    this.stan.on( 'connect', () =>
    {
      console.log( '[NATS-BUFFERED-CLIENT] Connected' );
      clearTimeout( this.connectTimer );
      this.connected = true;

      // Start processing the buffer
      //
      this.publishFailCount = 0;
      this.tick();
    } );

    this.stan.on( 'error', ( error ) =>
    {
      clearTimeout( this.connectTimer );
      console.error( '[NATS-BUFFERED-CLIENT] Server error', error );

      // Reconnect in 5 seconds
      //
      // this.connectTimer = setTimeout( () =>
      // {
      //   this.reconnect();
      // }, 5000 );
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
      if ( this.stan && this.connected )
      {
        const currentConnection = this.stan;
        currentConnection.on( 'disconnect', resolve );
        currentConnection.on( 'error',      reject  );
        currentConnection.close();
      }
      else
      {
        // Not connected
        //
        console.log( '[NATS-BUFFERED-CLIENT] Not connected so cannot disconnect' );
        resolve();
      }

      // Stop any pending timers
      //
      clearTimeout( this.connectTimer   );
      clearTimeout( this.republishTimer );

      // Cleanup connection properties
      //
      this.stan      = undefined;
      this.connected = false;
  } );
  }

  /**
   * Try to reconnect to the NATS server using our stored settings
   *
   * @memberof NatsBufferedClient
   */
  public reconnect()
  {
    if ( this.clusterId && this.clusterId )
    {
      // Connect will try to close any existing connection or connection attempt
      //
      this.connect( this.clusterId, this.clientId, this.clientOptions );
    }
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

            // Increment our failure counter
            //
            this.publishFailCount++;

            // If our failure counter has exceeded the threshold we may need to
            // reconnect to the server
            //
            if ( this.publishFailCount > 3 || error.message === 'stan: publish ack timeout' )
            {
              console.warn( '[NATS-BUFFERED-CLIENT] Trying to reconnect to server' );
              this.ticking = false;
              this.reconnect();
            }
            else
            {
              // Retry publish
              //
              this.republishTimer = setTimeout( () => {
                this.tick();
              }, 10 * this.publishFailCount );
            }
          }
          else
          {
            console.log( '[NATS-BUFFERED-CLIENT] Publish done', pub );
            this.publishFailCount = 0;

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
