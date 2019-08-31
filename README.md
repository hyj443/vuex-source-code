# 深入浅出Vuex源码

## 回顾一下Vuex是什么

Vuex 是一个专为Vue框架设计的，进行状态管理的库，将共享的数据抽离，放到全局形成一个单一的store，同时利用了Vue内部的响应式机制来进行状态的管理和更新，它是与Vue设计高度契合的库。

下图是Vue的单向数据流的特点图：
![单向数据流](https://vuex.vuejs.org/flow.png)

Vuex，在全局有一个state存放数据，，所有修改state的操作必须通过mutation进行，mutation的同时，提供了订阅者模式供外部插件调用获取state数据的更新。
所有异步操作都走action，比如调用后端接口异步获取数据，但在action中不能直接修改state，还是要通过若干个mutation来修改state，所以Vuex中数据流是单向的。
state的变化是响应式的，因为Vuex依赖Vue的数据双向绑定，需要new一个Vue对象来实现响应式化

![vuex组成](https://vuex.vuejs.org/vuex.png)

## Vuex中的store如何注入到组件中

Vuex作为Vue的插件，在使用Vuex前，要先安装Vuex，必须在 `new Vue()` 之前调用全局方法 `Vue.use(Vuex)`

```js
import Vuex from 'vuex';
Vue.use(vuex);
```

`import Vuex from 'vuex'`时，拿到的是下面这个定义在入口文件中的对象

```js
export default {
  Store,
  install,
  version: '__VERSION__',
  mapState,
  mapMutations,
  mapGetters,
  mapActions,
  createNamespacedHelpers
}
```

从 Vue 源码可知，调用全局方法 `Vue.use(Vuex)` ，会调用 `Vuex.install(Vue)`，所以你看到这里对外暴露的API中有install方法。

不妨看看 Vue 源码的 `Vue.use` 部分，是如何实现的：

```js
initUse(Vue);
function initUse (Vue) { // this指向Vue，因为Vue.use(plugin)
  Vue.use = function (plugin) {
    var installedPlugins = (this._installedPlugins || (this._installedPlugins = []));
    if (installedPlugins.indexOf(plugin) > -1) { // 注册过此插件
      return this
    }
    var args = toArray(arguments, 1); // 从索引1开始，参数类数组转成数组
    args.unshift(this);
    if (typeof plugin.install === 'function') { // 如果plugin是对象且有install方法
      plugin.install.apply(plugin, args); // 调用install，把Vue对象作为第一个参数传入
    } else if (typeof plugin === 'function') {
      plugin.apply(null, args);
    }
    installedPlugins.push(plugin); // 注册过的plugin推入数组
    return this
  };
}
```
所以可知，`Vue.use(plugin)` 时，会调用插件的`install`方法，并至少传入`Vue`
接下来看`Vuex`中的`install`做了什么
```js
let Vue
// ....
export function install(_Vue) {
  if (Vue && _Vue === Vue) {
    if (process.env.NODE_ENV !== 'production') {
      console.error( // 报错，已经使用 Vue.use(Vuex) 安装过了
        '[vuex] already installed. Vue.use(Vuex) should be called only once.'
      )
    }
    return
  }
  Vue = _Vue // 保存传入的Vue
  applyMixin(Vue)
}
```

所以install代码做了两件事：

1. 防止Vuex被重复安装

2. 执行applyMixin，并传入Vue对象

那，applyMixin做了什么呢？我们看看源码中的具体实现：

```js
export default function (Vue) {
  const version = Number(Vue.version.split('.')[0])
  if (version >= 2) {
    Vue.mixin({ beforeCreate: vuexInit })
    // Vue.mixin全局注册一个混入，影响注册之后创建的每个Vue实例。
  } else {/**/}

  function vuexInit () {
    const options = this.$options
    // options.store 就是new Vue 时传入的store，也就是根组件中注册的store
    if (options.store) { // 如果存在，代表当前组件是根组件
      this.$store = typeof options.store === 'function'
        ? options.store()
        : options.store
    } else if (options.parent && options.parent.$store) {
      // 如果this.$options没有store(意味着是子组件)，就取父组件的$store
      this.$store = options.parent.$store
    }
  }
}
```

applyMixin方法，全局注册混入一个beforeCreate钩子vuexInit，之后创建的每个 Vue 实例的生命周期中都会执行。

vuexInit中干的事：将 `new Vue()` 时传入的 `store` 保存到 `this.$store`，子组件则取其父组件实例上的 `$store`，层层下去，每一个组件中都可以通过 `this.$store` 取到 `store` 对象。

这种注入机制：通过在根实例中注册 store 选项，store 实例会注入到根组件下的所有子组件中，注入方法是子组件从父组件拿。

介绍完Vuex.install，既然我们`new Vue`时会注入store选项，要通过 `new Vuex.Store()` 来实例化store，Store构造函数接收一个对象，包含actions 、 getters 、 state 、 mutations 、 modules等。

```js
const store = new Vuex.Store({
  state,
  mutations,
  actions,
  getters,
  modules
})
```

我们来看看 Store 这个构造函数

## 探究 Store 类

我们先看看 `Store` 类的 `constructor` 方法

constructor 中做了很多事情。

首先浏览器环境下看是否调用过Vue.use(Vuex)，如果没有，自动安装；是否支持promise；必须用 new 创建 store

```js
if (!Vue && typeof window !== 'undefined' && window.Vue) {
  install(window.Vue) // 浏览器环境下如果没有安装过就自动install
}
if (process.env.NODE_ENV !== 'production') {
  assert(Vue, `must call Vue.use(Vuex) before creating a store instance.`)
  // 确保Vue存在
  assert(typeof Promise !== 'undefined', `vuex requires a Promise polyfill in this browser.`)
  // 确保Promise可用，Vuex源码依赖promise
  assert(this instanceof Store, `store must be called with the new operator.`)
  // Store类必须用new调用
}
```

然后进行一系列的初始化，初始化一些内部属性。其中重点是`new ModuleCollection(options)`，初始化module

```js
  const { plugins = [], strict = false} = options // 解构赋值
  // store实例的内部状态
  this._committing = false // 提交mutation状态的标志
  this._actions = Object.create(null) // 存放actions
  this._actionSubscribers = [] // action 订阅函数集合
  this._mutations = Object.create(null) // 存放mutations
  this._wrappedGetters = Object.create(null) // 存放getters
  this._modules = new ModuleCollection(options) // module收集器，options就是new Vuex.Store({options})的
  this._modulesNamespaceMap = Object.create(null) // 根据namespace存放module，模块命名空间
  this._subscribers = [] // 存储所有对mutation变化的订阅者
  this._watcherVM = new Vue() // vue实例，用它的$watch来观测变化

// Vuex支持store分模块传入，在内部用Module构造函数将传入的options构造成一个Module对象，
// 如果没有命名模块，默认绑定在this._modules.root上
// ModuleCollection 内部调用 new Module构造函数
```

插一句，这里创建空对象用的是 Object.create(null)，这是因为直接用字面量创建{}，等价于Object.create(Object.prototype)，它会从Object原型上继承一些方法，如hasOwnProperty、isPrototypeOf。Object.create(null)的原型是null

Store 使用的是单一的状态树，所有状态会集中到一个比较大的对象。当应用变得非常复杂时，store 对象可能很臃肿。为了解决这个，Vuex 允许我们将 store 分割成模块（module）。每个模块有自己的state、mutation、action、getter、甚至是嵌套子模块。从上至下进行同样方式的分割：

```js
const moduleA = {
  state: { ... },
  mutations: { ... },
  actions: { ... },
  getters: { ... }
}
const moduleB = {
  state: { ... },
  mutations: { ... },
  actions: { ... }
}
const store = new Vuex.Store({
  modules: {
    a: moduleA,
    b: moduleB
  }
})
store.state.a // -> moduleA 的状态
store.state.b // -> moduleB 的状态
```

从数据结构来看，模块的设计就是一个树形结构，store本身可以理解为一个root module，下面的module是子模块
构建这种树形结构的入口是：

```js
this._modules = new ModuleCollection(options)
```

我们看看`ModuleCollection`这个构造函数，在`src\module\module-collection.js`中

```js
export default class ModuleCollection {
  constructor (rawRootModule) {
    // register root module (Vuex.Store options)
    this.register([], rawRootModule, false)
  }

  get (path) {
    return path.reduce((module, key) => {
      return module.getChild(key)
    }, this.root)
  }

  getNamespace (path) {
    let module = this.root
    return path.reduce((namespace, key) => {
      module = module.getChild(key)
      return namespace + (module.namespaced ? key + '/' : '')
    }, '')
  }

  update (rawRootModule) {
    update([], this.root, rawRootModule)
  }

  register (path, rawModule, runtime = true) {
    if (process.env.NODE_ENV !== 'production') {
      assertRawModule(path, rawModule)
    }

    const newModule = new Module(rawModule, runtime)
    if (path.length === 0) {
      this.root = newModule
    } else {
      const parent = this.get(path.slice(0, -1))
      parent.addChild(path[path.length - 1], newModule)
    }

    // register nested modules
    if (rawModule.modules) {
      forEachValue(rawModule.modules, (rawChildModule, key) => {
        this.register(path.concat(key), rawChildModule, runtime)
      })
    }
  }

  unregister (path) {
    const parent = this.get(path.slice(0, -1))
    const key = path[path.length - 1]
    if (!parent.getChild(key).runtime) return

    parent.removeChild(key)
  }
}
```

实例化ModuleCollection其实就是执行 register 方法，这个方法接收 3 个参数，其中 path 是module的路径，这个值是我们拆分module时，module的key组成的数组，比如前面的例子，moduleA的path是['a']，moduleB的path是['b']，如果他们还有子模块，则子模块的path就大致形如['a','a1']、['b','b1']，第二个参数rawModule是定义module的配置，像rawRootModule就是传入实例化Store传入的config，注册根module。第三个参数runtime表示是否是一个运行时创建的module，

实例化ModuleCollection其实就是执行register方法，这个方法接受3个参数，其中path参数就是module的路径，这个值是我们拆分module时候module的key组成的一个数组，以上面为例的话，moduleA和moduleB的path分别为["a"]和["b"]，如果他们还有子module则子module的path的形式大致如["a"，"a1"]/["b"，"b1"]，第二个参数其实是定义module的配置，像rawRootModule就是我们构建一个Store的时候传入的那个对象，第三个参数runtime表示是否是一个运行时创建的module，紧接着在register方法内部通过assertRawModule方法遍历module内部的getters、mutations、actions是否符合要求，紧接着通过const newModule = new Module(rawModule, runtime)构建一个module对象，看一眼module类的实现：

所以使用了module后，state就被模块化，比如要调用根模块的state，则`store.state.xxx`，如果要调用a模块的state，则调用`store.state.a.xxx`
但你在跟模块注册的mutation和在子模块注册的mutation，如果同名的话，调用store.commit('xxx')，将会调用根模块和子模块的该mutation，除非区分命名
vuex2后的版本添加了命名空间的功能，使得module更加模块化，只有state是被模块化了，action mutation getter都还是在全局的模块下

属性初始化完毕后，从this中（store实例）解构出Store的原型上的dispatch、commit方法，进行二次包装（将执行时的this指向当前store实例，否则在组件里调用this.xxx时this指向当前vm实例）后，作为属性方法挂载到this上（store实例）

简言之，就是把Store类的原型上的两个方法挂载到当前store实例上，并把this也指向这个store实例。
这样我们在组件中通过 this.$store 直接调用这两方法时，方法中的this不会指向当前组件的vm实例
```js
  const store = this // store取到当前Store实例
  const { dispatch, commit } = this // dispatch、commit 取到Store原型上的同名方法
  this.dispatch = function boundDispatch(type, payload) { // 挂载到store实例
    // 执行时的this改成指向store，否则在组件里调用this.dispatch，this指向当前vm实例
    return dispatch.call(store, type, payload)
  }
  this.commit = function boundCommit(type, payload, options) {
    return commit.call(store, type, payload, options)
  }
```

接着，包括严格模式的设置、根state的赋值、模块的注册、state的响应式、插件的注册等等，其中的重点在 installModule 函数中，在这里实现了所有modules的注册。

```js
  // options中传入的，是否启用严格模式
  this.strict = strict
  // new ModuleCollection 构造出来的_mudules
  const state = this._modules.root.state

  // 初始化根module，同时递归注册所有的子module
  // 收集所有module的 getters 存储到 this._wrappedGetters
  // this._modules.root：根module才独有保存的Module对象
  installModule(this, state, [], this._modules.root)

  // 通过Vue实例，初始化 store.vm，使state变成响应式的，并将getters变成计算属性
  resetStoreVM(this, state)

  // 注册 Vuex 插件
  plugins.forEach(plugin => plugin(this))

// 调试工具注册
  const useDevtools = options.devtools !== undefined ? options.devtools : Vue.config.devtools
  if (useDevtools) {
    devtoolPlugin(this)
  }
```

到目前为止，constructor 中所有的代码已经分析完毕。
Store函数主要做了三件事：

1. 初始化一些内部变量，特别是初始化module
2. 执行installModule，安装了模块
3. 执行了resetStoreVM，初始化 store.vm，通过vm使store响应式
  
### installModule

```js
function installModule(store, rootState, path, module, hot) {

  const isRoot = !path.length // 是否为根module
  const namespace = store._modules.getNamespace(path) // 获取module的namespace

  // register in namespace map
  if (module.namespaced) {
    if (store._modulesNamespaceMap[namespace] && process.env.NODE_ENV !== 'production') {
      console.error(`[vuex] duplicate namespace ${namespace} for the namespaced module ${path.join('/')}`)
    }
    store._modulesNamespaceMap[namespace] = module
  }

  // set state
  if (!isRoot && !hot) { // 不为根且非热更新
    const parentState = getNestedState(rootState, path.slice(0, -1)) // 获取父级的state
    const moduleName = path[path.length - 1] // module的name
    store._withCommit(() => { // 将子module设置成响应式的
      Vue.set(parentState, moduleName, module.state)
    })
  }

  const local = module.context = makeLocalContext(store, namespace, path)

  module.forEachMutation((mutation, key) => { // 遍历注册mutation
    const namespacedType = namespace + key
    registerMutation(store, namespacedType, mutation, local)
  })

  module.forEachAction((action, key) => { // 遍历注册action
    const type = action.root ? key : namespace + key
    const handler = action.handler || action
    registerAction(store, type, handler, local)
  })

  module.forEachGetter((getter, key) => { // 遍历注册getter
    const namespacedType = namespace + key
    registerGetter(store, namespacedType, getter, local)
  })

  module.forEachChild((child, key) => { // 递归安装module
    installModule(store, rootState, path.concat(key), child, hot)
  })
}
```