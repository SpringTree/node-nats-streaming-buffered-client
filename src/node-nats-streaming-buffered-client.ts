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
   * Indicates if we think we're connected to NATS
   *
   * @private
   * @memberof NatsBufferedClient
   */
  private connected = false;

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
   * @memberof NatsBufferedClient
   */
  constructor( bufferSize: number = 10 )
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
      if ( this.stan )
      {
        console.log( '[NATS-BUFFERED-CLIENT] Disconnecting due to SIGINT' );
        this.disconnect().then( () => console.log( '[NATS-BUFFERED-CLIENT] Disconnected due to SIGINT' ) );
      }
    } );
  }

  /**
   * Connect to the NATS server
   *
   * @memberof NatsBufferedClient
   */
  public connect( clusterId: string, clientId: string, options?: nats.StanOptions )
  {
    // Disconnect any previous connection
    //
    if ( this.stan )
    {
      const currentConnection = this.stan;
      currentConnection.close();
      currentConnection.on( 'disconnect', () =>
      {
        console.log( '[NATS-BUFFERED-CLIENT] Disconnected previous connection' );
      } );
    }

    // Connect to NATS server
    //
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

      // Check if the buffer has items
      //
      this.publishFailCount = 0;
      if ( this.buffer.first() )
      {
        this.run();
      }

      this.connected = false;
    } );

    this.stan.on( 'disconnect', () =>
    {
      console.log( '[NATS-BUFFERED-CLIENT] Disconnected' );
      this.connected = false;
    } );
  }

  /**
   * Closes the NATS server connection
   *
   * @returns {Promise<any>}
   * @memberof NatsBufferedClient
   */
  public disconnect(): Promise<any>
  {
    return new Promise( ( resolve ) =>
    {
      if ( this.stan )
      {
        this.stan.on( 'disconnect', resolve );
        this.stan.close();
        this.stan = undefined;
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
    if ( this.clusterId && this.clusterId )
    {
      // Connect will try to close any existing connection
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
    // Check if the buffer is empty
    //
    const emptyBuffer = !this.buffer.first();

    // Push onto the end of the buffer
    //
    this.buffer.push( { subject, data } as IBufferItem );

    // Run the buffer processing if the buffer was empty before
    //
    if ( this.connected && emptyBuffer )
    {
      this.run();
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
  protected run()
  {
    const pub: IBufferItem | undefined = this.buffer.first();

    if ( pub && this.stan )
    {
      this.stan.publish( pub.subject, JSON.stringify( pub.data ), ( error ) =>
      {
        if ( error )
        {
          console.error( '[NATS-BUFFERED-CLIENT] Publish failed', error );

          // Increment our failure counter
          //
          this.publishFailCount++;

          // If our failure counter has exceeded the threshold we may need to
          // reconnect to the server
          //
          if ( this.publishFailCount > 10 )
          {
            this.reconnect();
          }
          else
          {
            // Retry publish
            //
            setTimeout( () => {
              this.run();
            }, 100 * this.publishFailCount );
          }

        }
        else
        {
          console.log( '[NATS-BUFFERED-CLIENT] Publish done', pub );

          this.publishFailCount = 0;

          // Remove the item from the buffer on successfull publish
          //
          this.buffer.shift();

          // Next!
          //
          this.run();
        }
      } );
    }
    else
    {
      console.log( '[NATS-BUFFERED-CLIENT] Buffer is empty' );
    }
  }
}
