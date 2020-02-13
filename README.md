# 逐行解析Vuex源码

## 回顾一下Vuex是什么

Vuex 是一个专为Vue框架设计的，进行状态管理的库，将共享的数据抽离，放到全局形成一个单一的store，同时利用了Vue内部的响应式机制来进行状态的管理和更新。
![vuex组成](https://vuex.vuejs.org/vuex.png)
Vuex，在全局有一个state存放数据，所有修改state的操作必须通过mutation进行，mutation的同时，提供了订阅者模式供外部插件调用，获取state数据的更新。
所有异步操作都走action，比如调用后端接口异步获取数据，action同样不能直接修改state，要通过若干个mutation来修改state，所以Vuex中数据流是单向的。
state的变化是响应式的，因为Vuex依赖Vue的数据双向绑定，需要new一个Vue对象来实现响应式化。

看源码之前再看一遍[Vuex文档](https://vuex.vuejs.org/zh/)会加深理解，建议抽空过一遍。

## Vuex的安装

Vuex 是 Vue 插件，在使用 Vuex 前，必须在 new Vue() 之前调用 Vue.use() 来安装 Vuex：

```js
import Vue from 'vue';
import Vuex from 'vuex';
Vue.use(vuex);

new Vue({
  // ...组件选项
})
```
>如果 Vue 插件是一个对象，它必须提供 install 方法。如果插件是一个函数，则它被作为 install 方法。install 接收的第一个参数就是 Vue 对象

src\index.js 入口文件中，Vuex 默认导出的对象如下：

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
可见对象中有 install 方法。Vue.use 执行时，会调用该 install 方法。我们看看 install：

```js
let Vue
// ....
export function install (_Vue) {
  if (Vue && _Vue === Vue) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[vuex] already installed. Vue.use(Vuex) should be called only once.')
    }
    return
  }
  Vue = _Vue
  applyMixin(Vue)
}
```

如果是初次调用 install，定义的 Vue 还为 undefined，if 语句块不执行，install 接收的 _Vue 是 Vue 构造函数，它赋给了 Vue。如果再次调用 install，Vue 已经有值，且和传入的 _Vue 相同的话，则开发环境下会打印警告：Vuex已经安装了，Vue.use(Vuex)只能调用一次。然后直接返回，避免 Vuex 插件的重复安装。

接着调用 applyMixin(Vue)，我们看看 applyMixin 这个函数：

```js
export default function (Vue) {
  const version = Number(Vue.version.split('.')[0])
  if (version >= 2) {
    Vue.mixin({ beforeCreate: vuexInit })
  } else {
    // Vue 1.x 的处理，不做分析
  }
  function vuexInit () {
    // store 注入
  }
}
``` 

真正实现插件的安装是在 applyMixin 中，如果 Vue 的版本是 2.x，调用 Vue.mixin，混入一个 beforeCreate 钩子：vuexInit。Vue.mixin 的作用是：全局注册一个混入，会影响之后创建的每个 Vue 实例。

这意味着，install 之后，之后创建的每个 Vue 实例的执行 beforeCreate 钩子函数时，都会执行 vuexInit。

vuexInit 顾名思义是初始化 vuex：

```js
function vuexInit () {
  const options = this.$options
  if (options.store) {
    this.$store = typeof options.store === 'function'
      ? options.store()
      : options.store
  } else if (options.parent && options.parent.$store) {
    this.$store = options.parent.$store
  }
}
```

vuexInit 钩子执行时，this 指向当前 Vue 实例，this.$options 获取的是当前 Vue 实例的 $options 对象。

如果 this.$options.store 存在，说明实例化 Vue 时传了 store 这个配置项。我们只有在创建 Vue 的根实例时，才会传入 store 对象：

```js
new Vue({
  store,
  router,
  render: h => h(App)
}).$mount('#app')
```

所以 this.$options.store 的存在说明当前实例是根实例，要给根实例添加 $store 属性，属性值为 options.store() 或 options.store，取决于 options.store 是否为函数。

如果当前不是根 Vue 实例，再判断如果它有父实例，并且父实例的 $store 有值，则也给当前实例添加 $store 属性，属性值为父组件的 $store 值。

可见 applyMixin 让每一个 Vue 组件实例的创建时，执行到 beforeCreate 钩子时，都会调用 vuexInit，给 Vue 组件实例添加 $store 属性，并且所有实例的 $store 属性都指向同一个 store 对象，即在任意组件中都可以通过 this.$store 访问根实例中注册的 store 对象

## store 对象的创建

根实例注册的 store 对象会向下注入到子组件实例中。问题来了，这个 store 对象是怎么创建的？它是通过实例化 Vuex.Store 创建的：

```js
const store = new Vuex.Store({
  state,
  mutations,
  actions,
  getters,
  modules
})
```

实例化 Vuex.Store 时传入一个包含 actions、getters、state、mutations、modules 等的配置对象，返回出 Store 实例。

我们看看 Store 这个构造函数。因为代码较长，我们拆分成几段：

```js
class Store {
  constructor(options = {}) {
    if (!Vue && typeof window !== 'undefined' && window.Vue) {
      install(window.Vue)
    }
    if (process.env.NODE_ENV !== 'production') {
      assert(Vue, `must call Vue.use(Vuex) before creating a store instance.`)
      assert(typeof Promise !== 'undefined', `vuex requires a Promise polyfill in this browser.`)
      assert(this instanceof Store, `store must be called with the new operator.`)
    }
    // ……
  }
  // ……
}
```

首先判断，如果本地 Vue 没有值（说明没有调用过 install），且当前是浏览器环境，且 window.Vue 存在，则传入 window.Vue 执行 install。这意味着 Vuex 在用户没有调用 Vue.use(Vuex) 时，能主动进行安装。

Vuex 的使用需要一些必要条件。在开发环境中，会执行3个 assert 函数，如果条件不具备则会抛错。

```js
export function assert (condition, msg) {
  if (!condition) throw new Error(`[vuex] ${msg}`)
}
```
3个assert函数所做的事是：

1. 如果本地 Vue 没有值，抛出错误：实例化 Store 之前必须调用 Vue.use(Vuex)。因为这样 Vue 构造函数才能传进来，供后续使用
2. 如果 Promise 不能用，抛出错误：Vuex 依赖 Promise。
3. 如果 Store 函数里的 this 不是 Store 的实例，抛出错误：Store 必须用 new 关键字调用

判断完环境后，开始初始化 Store 实例的属性，它们会保存一些内部状态：

```js
const { plugins = [], strict = false } = options
this._committing = false // 提交mutation状态的标志
this._actions = Object.create(null) // 存放actions
this._actionSubscribers = [] // action 订阅函数集合
this._mutations = Object.create(null) // 存放mutations
this._wrappedGetters = Object.create(null) // 存放getters
this._modules = new ModuleCollection(options) // module收集器
this._modulesNamespaceMap = Object.create(null) // 模块命名空间
this._subscribers = [] // 存储所有对mutation变化的订阅者
this._watcherVM = new Vue() // Vue实例
this._makeLocalGettersCache = Object.create(null)//存放生成的本地getters的缓存
// ...
this.strict = strict
```

如果实例化 Store 时传了 strict: true，则 Store 实例的 strict 属性为 true，代表严格模式，任何 mutation 处理函数以外修改 state 都会抛出错误。如果用户没传 strict 选项，则 store 实例的 strict 属性默认为 false。

我们暂时不具体了解每一个的实例属性的含义。但其中的重点是：

 `this._modules = new ModuleCollection(options)`
 
创建了 ModuleCollection 的实例赋给了实例属性 _modules，稍后会详细介绍，接下来继续看 Store 构造函数 ：

```js
const store = this
const { dispatch, commit } = this
this.dispatch = function boundDispatch (type, payload) {
  return dispatch.call(store, type, payload)
}
this.commit = function boundCommit (type, payload, options) {
  return commit.call(store, type, payload, options)
}
```

首先定义 store 变量指向当前 store 实例。再定义 dispatch 和 commit，通过解构 this 分别缓存了 Store 原型上的 dispatch 和 commit 方法。

接着，给 store 实例添加 dispatch 和 commit 方法，方法调用实际执行刚刚缓存的 dispatch 和 commit 方法，但执行时的 this 指向当前 store 实例。

具体 Store 原型上的 dispatch 和 commit 方法做了什么事情，后面会讲。

接着看 Store 构造函数：

```js
this.strict = strict
const state = this._modules.root.state
installModule(this, state, [], this._modules.root)
resetStoreVM(this, state)
plugins.forEach(plugin => plugin(this))
```
从 options 中解构出来的 strict 属性值，赋给 store 实例的 strict 属性。

前面提到，this._modules 是 ModuleCollection 的实例，我们稍后会讲到，它的 root 属性的值是根 module 对象，根 module 对象的 state 属性指向它的 state 对象。所以这里获取根 state 赋给 state 变量。

调用 installModule 进行模块的注册，传入 store 实例、根 state、[]、根 module 对象。

调用 resetStoreVM 函数，对 state 进行响应式化处理

遍历 plugins 数组，逐个注册 Vuex 自己的插件

上面这些后面会展开讲。到目前为止，Store 构造函数已经过了一遍。new Store 主要做了三件事：

1. 初始化一些内部属性，其中重点是 this._modules = new ModuleCollection(options)
2. 执行 installModule ，安装模块
3. 执行 resetStoreVM ，使store响应式化

我们将逐个细说这三个，先说初始化 _module 属性，即 new ModuleCollection(options)

### Module 收集

```js
this._modules = new ModuleCollection(options)
```

Vuex文档里是这么说：

> store 使用单一的状态树，用一个对象包含了全部的应用层级的状态，每个应用将仅仅包含一个 store 实例。

如果应用变得很复杂，store 对象就可能很臃肿。为了解决这个问题，Vuex 允许我们将 store 分割成模块(module)，每个模块都有自己的 state 、mutation、action、getter、甚至是嵌套子模块，像下面这样从上至下进行同样方式的分割：

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

上面是使用 module 的写法，store 本身可以看作是一个根 module，它有嵌套的子 module，形成一种用配置对象描述的树形结构。

new ModuleCollection 所实现的，是将这种树形结构转成通过父子关系彼此关联的单个对象的存在，即进行 module 的收集。

我们看看 `ModuleCollection` 构造函数：

```js
class ModuleCollection {
  constructor (rawRootModule) {
    this.register([], rawRootModule, false)
  }
  register (path, rawModule, runtime = true) {
    // ...
  }
  // ...
}
```
可见，new ModuleCollection(options) 就是执行原型方法 register：

```js
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
```
先解释 register 方法接收的这 3 个参数：

1. path：module 对象的属性名组成的数组，是 module 对象的唯一标识。
  像刚刚的例子，根 module 的 path 为 []，它的子模块 moduleA 的 path 是 ['a']，子模块 moduleB 的 path 是 ['b']，如果它们各自还有子模块，则它们的 path 就大致形如 ['a','a1']、['b','b1']
2. rawModule：定义当前 module 的 options 对象，后面统称为配置对象。rawRootModule 就是实例化 Store 时传入的配置对象，因为我们把创建的 store 对象看作是根 module，所以我们把它的配置对象看作根 module 的配置对象。
3. runtime 表示是否是一个运行时创建的 module，默认为 true。

```js
this.register([], rawRootModule, false)
```
new ModuleCollection(options)时，首次调用 register，第一个参数传入空数组，说明 register 的是根 module。rawRootModule 是实例化 Store 时传入的配置对象。

我们具体分段看 register 的内部：

```js
assertRawModule(path, rawModule)
const newModule = new Module(rawModule, runtime)
```
首先调用 assertRawModule 对 module 的配置对象作一些判断，遍历用户传的配置对象中的 getters、mutations、actions，判断是否符合要求，这里不作具体分析。

然后根据当前的配置对象 rawModule，创建一个 Module 实例，赋给变量 newModule。后面会详谈 Module 构造函数。

继续看 register：

```js
if (path.length === 0) {
  this.root = newModule
} else {
  const parent = this.get(path.slice(0, -1))
  parent.addChild(path[path.length - 1], newModule)
}
```

如果 path 是空数组，说明当前注册的 module 是根 module，则把刚刚创建的 Module 实例赋给 this.root，this 指向当前 ModuleCollection 的实例，即它的 root 属性保存了根 module 对象。

如果 path 不是空数组，即当前 register 的是子 module，稍后会讲解。

接下来是的 register 函数的最后一部分：

```js
if (rawModule.modules) {
  forEachValue(rawModule.modules, (rawChildModule, key) => {
    this.register(path.concat(key), rawChildModule, runtime)
  })
}
```
如果当前配置对象 rawModule 的 modules 属性有值，说明用户给它配置了子 module，则需要调用 forEachValue 遍历 modules 对象，进行子模块的递归注册，我们先看看 forEachValue 函数：

```js
export function forEachValue (obj, fn) {
  Object.keys(obj).forEach(key => fn(obj[key], key))
}
```

forEachValue 函数会遍历传入的 obj 对象的自有属性 key，逐个调用 fn。

所以这里做的是：遍历 rawModule.modules 对象里的每个 key，它们是子模块配置对象的键名，执行回调，传入 key 对应的配置对象 rawChildModule 和 key。在回调中会调用 register 函数，对子模块进行注册。

此时传入 register 的 path 是 `path.concat(key)`。我们知道，path 是当前注册的模块的路径，concat 上当前遍历的 key，就是当前子模块的路径。

比如模块 a 嵌套了模块 b，模块 b 嵌套了模块 c，那模块 c 的path是：['a','b'].concat('c')，即['a','b','c']

第二个参数rawChildModule，是当前遍历的属性值，即子模块的配置对象。

我们现在捋一捋：实例化 Store 必然会实例化 MoudleCollection，进行 module 的收集，至少会调用一次 register 进行根 module 的注册，如果根配置对象配置了嵌套的子模块，则会继续调用 register 注册子 module。子模块的 path 不是空数组，回到刚刚那个 else 语句块:

```js
if (path.length === 0) {
  this.root = newModule
} else {
  const parent = this.get(path.slice(0, -1))
  parent.addChild(path[path.length - 1], newModule)
}
```

此时 path 是当前注册的子模块的路径，path.slice(0, -1) 是去掉最后一项的数组，它代表的是父模块的 path。将它传入 get 方法执行，是为了获取该当前子模块的父 module 对象，我们看看 get 这个 ModuleCollection 的原型方法：

```js
get (path) {
  return path.reduce((module, key) => {
    return module.getChild(key)
  }, this.root)
}
```

reduce 的详细用法可以参考 [reduce - MDN](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Array/Reduce)

我们先看一下 getChild 和 addChild 这两个 Module 的原型方法，再回来理解 get。

```js
getChild (key) {
  return this._children[key]
}
addChild (key, module) {
  this._children[key] = module
}
```

getChild 方法返回的是 this._children[key]，即通过 key 获取到当前 module 的子 module 对象，我们讲 Module 构造函数时会讲 _children 属性。

addChild 方法是给当前 module 对象的 _children，添加 key 和对应的子模块对象。到这里你可以猜到父子 module 对象的关系是靠 _children 建立的。

回到 ModuleCollection 的原型方法 get：

```js
get (path) {
  return path.reduce((module, key) => {
    return module.getChild(key)
  }, this.root)
}
```
为了方便理解，假设传入 get 的 path 为 ['a','b','c']

reduce 累加器的初始值为 this.root，是根 module，第一次迭代中，执行回调返回的是：根 module 的 key 为 'a' 的子 module，并且该子 module 会作为下一次迭代的累加器的值，即传给回调的第一个参数 module，第二次迭代执行返回的是：'a' 模块下的子模块 'b' 的模块对象，以此类推，最后 get 方法返回 ['a','b','c'] 对应的模块。

所以 get 方法是根据 path 数组，通过 reduce 迭代，返回出 path 对应的 module 对象。

所以，获取到当前模块的父模块对象，赋给 parent，然后调用 addChild 方法，给父模块对象的 _children 属性，添加当前子模块对象。

```js
 const parent = this.get(path.slice(0, -1))
 parent.addChild(path[path.length - 1], newModule)
```

path[path.length - 1]，path 数组的最后一项，即当前模块的 key 名，newModule 是当前模块对象，它们将作为键值对添加到父模块对象的 _children对象中

通过 module 的 _children 属性，建立了父子模块对象之间的父子关系。现在未加工的配置对象形成的树形结构，已经转成了一个个散落的父子 module 对象。

我们再整体梳理一下 register方法：

```js
register (path, rawModule, runtime = true) {
  const newModule = new Module(rawModule, runtime)
  if (path.length === 0) {
    this.root = newModule
  } else {
    const parent = this.get(path.slice(0, -1))
    parent.addChild(path[path.length - 1], newModule)
  }
  if (rawModule.modules) {
    forEachValue(rawModule.modules, (rawChildModule, key) => {
      this.register(path.concat(key), rawChildModule, runtime)
    })
  }
}
```

首先 register 方法必然至少调用一次，在实例化 Store 时，会调用 new ModuleCollection，会执行 register，根据根配置对象注册为根 module 对象，只要配置了嵌套模块，就会递归调用 register，注册每一个子模块，每一个子模块都通过 path 找到自己的父模块对象，通过 addChild 添加 _children 属性建立父子关系，然后再看自己有没有嵌套子模块，如果有就继续递归调用 register，最后完成整个 module 树的注册。

概况来说，new ModuleCollection(即 register 的执行)，做了两件事：

1. 根据 rawModule 配置对象通过 new Module 创建 module 对象
2. 通过递归调用 register，建立父子 module 对象之间的父子关系

new Module 是在 new ModuleCollection 的过程中发生的，先生成 module 对象，再进行 module 对象父子关系的收集。

提一下，module 对象或模块对象，都指的是 Module 实例。我们看看 Module 构造函数

## Module 构造函数

用户定义的 module 配置对象称为 rawModule，未经加工的配置对象，传入 new Moudle 执行后，实现了从 rawModule 到 module 对象的转变。

```js
class Module {
  constructor (rawModule, runtime) {
    this.runtime = runtime
    this._children = Object.create(null)
    this._rawModule = rawModule
    const rawState = rawModule.state
    this.state = (typeof rawState === 'function' ? rawState() : rawState) || {}
  }
  get namespaced () {
    return !!this._rawModule.namespaced
  }
  // 原型方法后续会介绍
}
```
Module 的实例会挂载一些属性，比如 _children，它初始值是一个空对象，用来存放当前 module 对象的子 module 对象。_rawModule 属性保存当前模块的配置对象。

然后获取配置对象中 state 的属性值，如果它为函数，则执行的返回值赋给实例的 state 属性，如果不是函数，直接赋给 state 属性，如果它是 undefined，即当前模块的配置对象没有配置 state，则 state 属性值为一个空对象

可见，用户声明模块的 state 我们可以传一个返回一个对象的函数，返回的对象会被赋给 this.state。

这和 Vue 组件里的 data 一样，如果使用一个纯对象来声明模块的state，那么这个 state 对象会通过引用被共享，导致 state 对象被修改时，store 或模块间数据相互污染。

因为有时我们可能需要创建一个模块的多个实例，比如，创建多个 store 实例，或在一个 store 中多次注册同一个模块

namespaced 是 Module 的原型属性，使用 get 给它的属性描述符对象添加了 get 方法，当 Module 实例读取 namespaced 时，会沿着原型链找到并读取原型上的 namespaced，触发了它的 get 方法，返回模块的配置对象的 namespaced 属性值的真假

### installModule 初始化根模块对象

我们在讲 Store 构造函数时，它重点的做的三件事，现在我们讲完了模块对象的创建和建立父子关系，接着就是模块的安装(初始化根模块对象)，也就是 constructor 中的这句：

```js
installModule(this, state, [], this._modules.root)
```
我们看看installModule的实现：

```js
function installModule(store, rootState, path, module, hot) {
  const isRoot = !path.length // 是否为根module
  const namespace = store._modules.getNamespace(path) // 获取module的namespace
  if (module.namespaced) {
    if (store._modulesNamespaceMap[namespace] && process.env.NODE_ENV !== 'production') {
      console.error(`[vuex] duplicate namespace ${namespace} for the namespaced module ${path.join('/')}`)
    }
    store._modulesNamespaceMap[namespace] = module
  }
  if (!isRoot && !hot) { // 不为根且非热更新
    const parentState = getNestedState(rootState, path.slice(0, -1)) // 获取父级的state
    const moduleName = path[path.length - 1] // module的name
    store._withCommit(() => { // 将子module设置成响应式的
      Vue.set(parentState, moduleName, module.state)
    })
  }
  const local = module.context = makeLocalContext(store, namespace, path)
  module.forEachMutation((mutation, key) => {...}) // 遍历注册mutation
  module.forEachAction((action, key) => {...}) // 遍历注册action
  module.forEachGetter((getter, key) => {...})// 遍历注册getter
  module.forEachChild((child, key) => { // 递归安装module
    installModule(store, rootState, path.concat(key), child, hot)
  })
}
```
由Vuex文档可知：

Vuex 2后的版本添加了命名空间的功能，使用了module后，state就被模块化，比如要调用根模块的state，则`store.state.xxx`，如果要调用a模块的state，则调用`store.state.a.xxx`。

但默认情况下，模块内部的 action、mutation 和 getter 是会注册在全局命名空间的。比如，不同模块有同名的 mutation，会导致这些模块能够对同一个 mutation 作出响应。

如果希望你的模块具有更高的封装度和复用性，你可以通过添加 namespaced: true 的方式，使其成为带“命名空间”的模块。当模块被注册后，它的所有 getter、action 及 mutation 都会自动根据模块注册的路径调整命名。例如：

```js
const store = new Vuex.Store({
  modules: {
    account: {
      namespaced: true,
      state: {}, 
      getters: {
        isAdmin() {...} // -> getters['account/isAdmin']
      },
      actions: {
        login() {...} // -> dispatch('account/login')
      },
      mutations: {
        login() {...} // -> commit('account/login')
      },
      modules: { // 继承父模块的命名空间
        myPage: {
          state: {},
          getters: {
            profile() {...} // -> getters['account/profile']
          }
        },
        posts: {
          namespaced: true,// 进一步嵌套命名空间
          state: {},
          getters: {
            popular() {...} // -> getters['account/posts/popular']
          }
        }
      }
    }
  }
})
```

我们先看 installModule 函数接收什么参数：

- store：Store实例，就是new Vuex.Store时传入的store对象。
- rootState：根 state 对象
- path：当前的模块对应的路径数组
- module：当前模块对象
- hot：是否支持热重载（这里不讨论它）

installModule 代码较长，我们分段来看

```js
const isRoot = !path.length
const namespace = store._modules.getNamespace(path)
if (module.namespaced) {
  if (store._modulesNamespaceMap[namespace] && process.env.NODE_ENV !== 'production') {
    console.error(`[vuex] duplicate namespace ${namespace} for the namespaced module ${path.join('/')}`)
  }
  store._modulesNamespaceMap[namespace] = module
}
```

首先，使用变量 isRoot 来标识当前模块是否为根模块，可见根模块和子模块的 install 不太一样。

接着，调用 getNamespace 函数，根据当前模块的 path 获取当前模块的命名空间。我们看看 ModuleCollection 的原型方法getNamespace：

```js
getNamespace (path) {
  let module = this.root
  return path.reduce((namespace, key) => {
    module = module.getChild(key)
    return namespace + (module.namespaced ? key + '/' : '')
  }, '')
}
```
getNamespace 首先获取到根 module 对象，然后调用 path 数组的 reduce 方法，累加器初始值为 ''，沿着 path，每次迭代获取到子模块对象 module，如果 module.namespaced 存在，即当前模块的配置对象中传了 namespaced: true，就将上一次执行回调的返回的字符串，拼上当前的 key 字符串和 '/'，否则拼接''。

reduce迭代结束时，返回出当前模块的 namespace 字符串，称它为命名空间字符串。

```js
if (module.namespaced) {
  if (store._modulesNamespaceMap[namespace] && process.env.NODE_ENV !== 'production') {
    console.error(`[vuex] duplicate namespace ${namespace} for the namespaced module ${path.join('/')}`)
  }
  store._modulesNamespaceMap[namespace] = module
}
```

store 对象的 _modulesNamespaceMap 属性值是一个对象，专门保存各个模块的命名空间字符串。

如果当前模块使用了命名空间，再判断，如果已经存在于_modulesNamespaceMap，则在开发环境下报错提示：命名空间的名称重复了。如果不存在，则将命名空间和它对应的 module 对象，作为键值对添加到 _modulesNamespaceMap 对象中。

继续看 installModule 的代码：

```js
if (!isRoot && !hot) {
  const parentState = getNestedState(rootState, path.slice(0, -1))
  const moduleName = path[path.length - 1]
  store._withCommit(() => {
    if (process.env.NODE_ENV !== 'production') {
      if (moduleName in parentState) {
        console.warn(
          `[vuex] state field "${moduleName}" was overridden by a module with the same name at "${path.join('.')}"`
        )
      }
    }
    Vue.set(parentState, moduleName, module.state)
  })
}
```
如果当前模块不是根模块，且非热更新，执行 if 语句块。

首先，根据根 state 和父模块的 path，通过调用 getNestedState 函数，获取当前模块的父 state。我们结合 getNestedState 来看：

```js
function getNestedState (state, path) {
  return path.reduce((state, key) => state[key], state)
}
```

父模块的 path 数组调用 reduce，累加器的初始值为根 state，每次迭代返回出它的子模块的 state，沿着path路径，一个个往下获取子 state，直到获取到当前 state 的父 state。就比如`store.state` >> `store.state.a` >> `store.state.a.b`...

`const moduleName = path[path.length - 1]` 获取到当前模块的 key 名，赋给 moduleName

接着调用 Store 的原型方法 _withCommit，传入一个回调函数，我们先看看这个回调函数做了什么：

```js
if (process.env.NODE_ENV !== 'production') {
  if (moduleName in parentState) {
    console.warn(
      `[vuex] state field "${moduleName}" was overridden by a module with the same name at "${path.join('.')}"`
    )
  }
}
Vue.set(parentState, moduleName, module.state)
```

开发环境下，如果当前模块的 key 名（比如叫 value），这个名称已经存在于父模块（假设模块名叫 foo）的state对象中，会有这样的问题：当你通过 store.state.foo.value 期望获取父模块 foo 的 state 的 value 值时，你拿到的却是当前子模块 value 的配置对象，即父模块的 state 的 value 属性被遮蔽了，所以要报错提示。

所以，模块的 key 名不能和父模块的 state 对象中的 key 冲突

`Vue.set(parentState, moduleName, module.state)`

这是利用 Vue.set 方法给父模块的 state 对象添加响应式属性，属性名为当前模块名，属性值为模块的 state 对象。

这么做后，用户就能通过当前模块名，读取它父模块的 state 的对应模块名，获取到当前模块的 state 对象。并且这样的 state 里的属性和 Vue 的 data 对象中的属性一样，是响应式的。 

我们回头看看 _withCommit 这个 Store 的原型方法

```js
_withCommit (fn) {
  const committing = this._committing
  this._committing = true
  fn()
  this._committing = committing
}
```
_withCommit 接收函数 fn，首先把当前 store 的 _committing 置为 true，然后执行 fn，再把 _committing 恢复为原来的值。可见，_withCommit 的作用是，保证了 fn 执行的过程中，_committing 的值为 true。

为什么要这么做？

因为 fn 中有修改 state 的操作：通过 Vue.set 给父 state 对象添加响应式属性。所有合法的修改 state 的操作，都会放在 _withCommit 的回调 fn 中进行，保证了这个过程的 _committing 为 true，其他时刻都为 false，因此任何不合法修改 state 的动作都会报错提示：不要试图在 mutation handler 之外改动 state 对象。

接下来，注册 mutation 等：

```js
const local = module.context = makeLocalContext(store, namespace, path)

module.forEachMutation((mutation, key) => {
  const namespacedType = namespace + key
  registerMutation(store, namespacedType, mutation, local)
})
```

首先执行 makeLocalContext 方法，传入 store 对象，当前模块的命名空间，当前的模块路径 path，返回值赋给 local 和module.context。

makeLocalContext 是干嘛的：

```js
function makeLocalContext (store, namespace, path) {
  const noNamespace = namespace === ''
  const local = {
    // dispatch:....
    // commit:....
  }
  Object.defineProperties(local, {
    getters: {
      get: noNamespace
        ? () => store.getters
        : () => makeLocalGetters(store, namespace)
    },
    state: {
      get: () => getNestedState(store.state, path)
    }
  })
  return local
}
```

首先用 noNamespace 变量的真假，代表该模块是否使用了命名空间。然后创建一个对象 local，里面定义了dispatch、commit方法，然后再通过 Object.defineProperties 定义它的两个属性 getters 和 state，最后返回出 local 对象。

我们先看 local 的 dispatch 方法：

```js
const local = {
  dispatch: noNamespace ? store.dispatch : (_type, _payload, _options) => {
    const args = unifyObjectStyle(_type, _payload, _options)
    const { payload, options } = args
    let { type } = args
    if (!options || !options.root) {
      type = namespace + type
      if (process.env.NODE_ENV !== 'production' && !store._actions[type]) {
        console.error(`[vuex] unknown local action type: ${args.type}, global type: ${type}`)
        return
      }
    }
    return store.dispatch(type, payload)
  },
}
```
我们知道，dispatch 方法用来分发 action 的。

如果当前模块没有使用命名空间，则直接把 store 对象的 dispatch 方法赋给 local.dispatch。

如果当前模块有自己的命名空间，则重新定义 local.dispatch 方法，它可以接收三个参数：
1. _type：即 action 的名称
2. _payload：载荷对象
3. _options：配置对象

这 3 个参数会先传入 unifyObjectStyle 函数执行，返回值赋给 args。unifyObjectStyle 其实是对参数做归一化处理的：

```js
function unifyObjectStyle (type, payload, options) {
  if (isObject(type) && type.type) {
    options = payload
    payload = type
    type = type.type
  }
  if (process.env.NODE_ENV !== 'production') {
    assert(typeof type === 'string', `expects string as the type, but found ${typeof type}.`)
  }
  return { type, payload, options }
}
```

如果第一个参数接收的是对象且存在 type 属性，则将传入的第二个参数作为 options ，第一个参数作为 payload，type 则取第一个参数的 type 属性

开发环境下，如果 type 不是字符串，抛出错误，也就是 action mutation 等的命名需要是一个字符串。

最后返回出包含 type, payload, options 的对象。回到 local.dispatch 方法，args 拿到这个参数对象后，从中解构出 type, payload, options 变量。

```js
const { payload, options } = args
let { type } = args
if (!options || !options.root) {
  type = namespace + type
  if (process.env.NODE_ENV !== 'production' && !store._actions[type]) {
    console.error(`[vuex] unknown local action type: ${args.type}, global type: ${type}`)
    return
  }
}
return store.dispatch(type, payload)
```

如果 options 不存在 或 options 对象里没有 root，则将 type 改为命名空间字符串和 type 的拼接后的结果，说明用户没有强制规定把该 action 注册在全局。

在开发环境下，判断，如果 store 对象的存放 actions 的 _actions 对象里，没有名为 type 的 action，这说明用户通过 dispatch 想要分发的这个 action 不存在，于是报错提示，并直接返回。

最后返回出 store.dispatch 的执行结果，传入的是考虑了命名空间的本地 type，和 payload 载荷对象。

到此，你会发现，store.dispatch 和 local.dispatch 的区别是前者所有传入的 type 都是不带命名空间的，后者执行传入的 type 是考虑了命名空间的，是本地的 type。

再来看 local.commit，我们知道，commit 是提交 mutation 的方法。如果当前模块没有命名空间，直接将 store.commit 赋给 local.commit，否则重新定义 local.commit：

```js
commit: noNamespace ? store.commit : (_type, _payload, _options) => {
  const args = unifyObjectStyle(_type, _payload, _options)
  const { payload, options } = args
  let { type } = args
  if (!options || !options.root) {
    type = namespace + type
    if (process.env.NODE_ENV !== 'production' && !store._mutations[type]) {
      console.error(`[vuex] unknown local mutation type: ${args.type}, global type: ${type}`)
      return
    }
  }
  store.commit(type, payload, options)
}
```

定义的这个新函数可以接收三个参数：
1. _type：mutation的名字
2. _payload：载荷对象
3. _options：配置对象

这 3 个参数会传入 unifyObjectStyle 函数做归一化处理，返回值赋给 args。

然后从 args 对象中解构出 type, payload, options 变量。

如果 options 不存在或 options 对象里没有 root，说明用户没有强制规定该 mutation 注册在全局，所以将 type 会改写命名空间字符串和 type 的拼接结果。

在开发环境下，会判断，如果 store 对象的存放 mutation 的 _mutations 对象里，没有名为 type 的 mutation，就报错提示，告诉用户你要提交的 mutation 不存在，然后直接返回。

最后 local.commit 返回出 store.commit 的执行结果，传入的是考虑了命名空间的本地 type，和 payload 载荷对象。store.commit 和 local.commit 的区别是前者所有传入的 type 都是不带命名空间的

```js
Object.defineProperties(local, {
  getters: {
    get: noNamespace
      ? () => store.getters
      : () => makeLocalGetters(store, namespace)
  },
  state: {
    get: () => getNestedState(store.state, path)
  }
})
return local
```

接着，通过 Object.defineProperties 给 local 对象定义两个响应式属性：getters 和 state。

读取 local.state 时，会触发 state 的 get 方法，返回 getNestedState 函数的执行结果，前面已经分析过，getNestedState 函数是用来获取当前模块的 state 对象。state 这个响应式属性并没有设置 set 方法，说明它是一个只读属性，不能直接对它进行修改。

读取 local.getters 时，会触发 getters 的 get 方法，如果当前模块没有命名空间，则 get 方法会直接返回 store.getters，没有命名空间意味着，从全局 store 拿 getters 就行，如果有命名空间，get 方法执行返回 makeLocalGetters 函数的执行结果，传入的是 store 对象和当前的命名空间。

看看 makeLocalGetters 函数：

```js
function makeLocalGetters (store, namespace) {
if (!store._makeLocalGettersCache[namespace]) {
    const gettersProxy = {}
    const splitPos = namespace.length
    Object.keys(store.getters).forEach(type => {
      if (type.slice(0, splitPos) !== namespace) return
      const localType = type.slice(splitPos)
      Object.defineProperty(gettersProxy, localType, {
        get: () => store.getters[type],
        enumerable: true
      })
    })
    store._makeLocalGettersCache[namespace] = gettersProxy
  }
  return store._makeLocalGettersCache[namespace]
}
```
store 对象有个 _makeLocalGettersCache 属性，是一个对象，专门缓存生成的本地 getters。

首先看这个缓存对象中是否存在当前命名空间，如果有，就直接返回缓存值，如果没有就执行if语句块。

if语句块中，首先定义一个空对象 gettersProxy，然后获取命名空间字符串的长度，赋给 splitPos。

然后遍历 store.getters 对象，如果将 type 字符串从开头 slice 到 splitPos 位置，和命名空间字符串不相等，直接返回。这样在遍历的过程就留下了当前模块的 getter

然后获取本地的type，即该 getter 的 key 名，赋给 localType，在 gettersProxy 对象上定义 localType 只读属性，读取它时返回 store.getters 中完整的考虑了命名空间的 type 对应的 getter。

遍历完 store.getters 后，gettersProxy 对象就存放很多键值对，所有本地的 type，和它对应的getter。

将 gettersProxy 赋给 store._makeLocalGettersCache[namespace]，_makeLocalGettersCache对象中，namespace 命名空间，对应的属性值是一个对象，存放的是本地的 getter 名和对应的 getter。最后返回出 store._makeLocalGettersCache[namespace]

由此可见，makeLocalGetters 就是根据命名空间，在全局 getters 对象中找出当前命名空间对应的getter，创建并返回一个键是本地 getter 名，值是对应的 getter的对象。于是可以通过本地 type 就能访问全局 type 对应的 getter。

到此 local 对象填充完毕，makeLocalContext 函数返回 local 对象

```js
const local = module.context = makeLocalContext(store, namespace, path)
```

回到 installModule 函数，现在 local 对象里就有：为当前模块设置的局部化的（本地的）dispatch、commit 方法，和 getter 和 state 属性。

接下来是注册 mutation，调用 Module 的原型方法 forEachMutation，将回调函数传入执行

```js
module.forEachMutation((mutation, key) => {
  var namespacedType = namespace + key;
  registerMutation(store, namespacedType, mutation, local);
})

forEachMutation (fn) {
  if (this._rawModule.mutations) {
    forEachValue(this._rawModule.mutations, fn)
  }
}
```
我们先看 forEachMutation 函数，它会判断如果当前模块的配置对象传了 mutations，就调用 forEachValue 遍历这个 mutations 对象，对每个键值对执行 fn。

我们看看这个传入的 fn，它首先将当前模块的命名空间字符串，拼接上，当前遍历的 mutation 的 key 名，赋给 namespacedType，即结合了命名空间的 mutation 名。

调用 registerMutation 进行 mutation 方法的注册，我们看看registerMutation函数：

```js
function registerMutation (store, type, handler, local) {
  const entry = store._mutations[type] || (store._mutations[type] = [])
  entry.push(function wrappedMutationHandler (payload) {
    handler.call(store, local.state, payload)
  })
}
```
结合`registerMutation(store, namespacedType, mutation, local);`来看

registerMutation 函数可以接收 4 个参数：

1. store：store 对象，即 new Vuex.Store 创建的 store 实例
2. type：接收的是 namespacedType：拼接了命名空间字符串的全局的 mutation 名
3. handler：mutation 的属性值，即 mutation 对应的处理函数。
4. local：即 makeLocalContext 函数返回的对象，包含为当前模块设置的局部化的 dispatch、commit 方法，和 getters、state 属性

`const entry = store._mutations[type] || (store._mutations[type] = [])`

我们知道 store._mutations，是个存放 mutation 的对象，如果考虑了命名空间的全局 type 在 store._mutations 对象中，没有对应的 mutation，那就将 store._mutations[type] 初始化为一个空数组，用来存放 type 对应的 mutation。然后 store._mutations[type] 的引用赋给 entry

继续看 registerMutation，接下来：

```js
entry.push(payload => {
  handler.call(store, local.state, payload);
})
```

这是往 store._mutations[type] 数组推入一个 wrappedMutationHandler 函数，它是对用户传的 mutation 函数的一层包装，它执行就会执行用户配置的 mutation 处理函数，并执行时 this 指向 store 对象，注意，handler 执行时接收的是 local.state，是局部化的 state，和 mutation 函数接收的 payload 载荷对象。

于是遍历完当前模块的 mutations 对象后，store._mutations 对象中，每一个 mutation 名都对应了一个数组，数组里存放了对应的 mutation 函数。

接着，是 action 的注册

```js
module.forEachAction((action, key) => {
  const type = action.root ? key : namespace + key
  const handler = action.handler || action
  registerAction(store, type, handler, local)
})

forEachAction (fn) {
  if (this._rawModule.actions) {
    forEachValue(this._rawModule.actions, fn)
  }
}
```

forEachAction 函数中，如果当前模块的配置对象传了 actions 对象，则调用 forEachValue 遍历 actions 对象，执行回调函数，回调函数接收属性值 action 和对应的 key。

在回调函数中，如果用户在 action 配置对象中传了 root: true，说明他想在这个带命名空间的模块中注册全局的 action，那么直接把 key 赋给 type，否则还是命名空间字符串拼接 key。

用户配置 actions 时，可以写成对象形式，然后对象的 handler 属性传处理函数。也可以直接写成函数，因此优先获取第一个参数中的 handler 属性值，如果没有，直接取第一个参数作为 handler。

调用 registerAction 进行 action 的注册。

```js
function registerAction (store, type, handler, local) {
  const entry = store._actions[type] || (store._actions[type] = [])
  entry.push(function wrappedActionHandler (payload) {
    let res = handler.call(store, {
      dispatch: local.dispatch,
      commit: local.commit,
      getters: local.getters,
      state: local.state,
      rootGetters: store.getters,
      rootState: store.state
    }, payload)
    if (!isPromise(res)) {
      res = Promise.resolve(res)
    }
    if (store._devtoolHook) {
      return res.catch(err => {
        store._devtoolHook.emit('vuex:error', err)
        throw err
      })
    } else {
      return res
    }
  })
}
```
首先判断 store._actions 这个对象是否存在当前 action 名对应的数组，如果没有，则初始化为空数组，用来存放 action 名对应的action。

然后向这个数组中推入一个 wrappedActionHandler 函数。它是对用户传的 action 函数的封装。

wrappedActionHandler 函数中：首先会调用用户配置的 action 的 handler 函数，返回值赋给 res 缓存起来，执行时的 this 指向 store 对象，handler 函数的第二个参数接收一个对象，它包含和 store 对象一样的属性名，称它为 context 对象，还接收用户传入的 payload 载荷对象。

注意这个 context 对象，它和 store 对象的不同之处在于：它的state getters commit dispatch 属性保存的是局部化的属性和方法，不是全局的。

执行了 handler 后，判断返回值 res，如果它不是 promise 实例，就将它变成成功值为 res 的 promise 实例，这说明 Vuex 是期待用户写 action 函数时返回出一个 promise 实例的，如果没有返回，也会包裹成一个 promise 实例返回。(使用了 devtools 的情况不作分析了)

接着，注册 getter

```js
module.forEachGetter((getter, key) => {
  const namespacedType = namespace + key
  registerGetter(store, namespacedType, getter, local)
})

forEachGetter (fn) {
  if (this._rawModule.getters) {
    forEachValue(this._rawModule.getters, fn)
  }
}
```
forEachGetter 函数中，如果当前模块的配置对象中传了 getters，遍历这个 getters 对象，执行回调函数 fn。

在回调函数中，首先获取当前模块的命名空间和 key 拼接后的字符串，赋给 namespacedType，然后调用 registerGetter 注册 getter

```js
function registerGetter (store, type, rawGetter, local) {
  if (store._wrappedGetters[type]) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[vuex] duplicate getter key: ${type}`)
    }
    return
  }
  store._wrappedGetters[type] = function wrappedGetter (store) {
    return rawGetter(
      local.state, // local state
      local.getters, // local getters
      store.state, // root state
      store.getters // root getters
    )
  }
}
```
registerGetter 函数中，首先判断，如果 store._wrappedGetters 对象中，全局 type 对应的 getter 已经存在，就报错提示：你注册的这个 getter 名字出现重复。然后直接返回。

如果 type 对应的 getter 不存在，那就往 store._wrappedGetters 对象中添加属性 type 和对应的 wrappedGetter 方法。它是 rawGetter 方法的封装。

rawGetter 就是当前遍历的用户配置的 getter 函数。rawGetter 执行传入的是 local 对象的state、getters、和根state，根getters。

到此 mutation、action、getter 都注册完了，来到了 installModule 的最后一步，遍历当前模块的子模块，进行子模块的安装：

```js
module.forEachChild((child, key) => {
  installModule(store, rootState, path.concat(key), child, hot)
})
forEachChild (fn) {
  forEachValue(this._children, fn)
}
```

调用 forEachChild 方法，将回调函数传入，遍历当前模块的 _children 数组，数组里存放着它的子模块对象，执行回调，回调中会递归调用 installModule 去安装子模块，传入的分别是：store对象，根state对象，子模块对象的 path，子模块对象本身，和hot。

这样，子模块也得到了安装，即注册了子模块的 mutation、action、getter。

## resetStoreVM

好了，我们现在来到实例化 Store 构造函数的核心三件事的最后一件：响应式化state
Vuex文档的原话：

>Vuex 的状态存储是响应式的。当 Vue 组件从 store 中读取 state 时，若 store 中的 state 发生变化，那么相应的组件也会相应地得到更新。

也就是，state 对象中的属性被观测了，值的变化会触发监听它的依赖。那 Vuex 是如何把 state 对象转成响应式数据呢？靠的是这句：

```js
resetStoreVM(this, state)
```
根据之前分析 Store 构造函数我们知道，传入 resetStoreVM 的 this 是 store 对象，state 是根 state，我们看看 resetStoreVM：

```js
function resetStoreVM (store, state, hot) {
  const oldVm = store._vm
  store.getters = {}
  store._makeLocalGettersCache = Object.create(null)
  const wrappedGetters = store._wrappedGetters
  const computed = {}
  forEachValue(wrappedGetters, (fn, key) => {
    computed[key] = partial(fn, store)
    Object.defineProperty(store.getters, key, {
      get: () => store._vm[key],
      enumerable: true // for local getters
    })
  })
  const silent = Vue.config.silent
  Vue.config.silent = true
  store._vm = new Vue({
    data: {
      $$state: state
    },
    computed
  })
  Vue.config.silent = silent

  if (store.strict) {
    enableStrictMode(store)
  }
  if (oldVm) {
    if (hot) {
      store._withCommit(() => {
        oldVm._data.$$state = null
      })
    }
    Vue.nextTick(() => oldVm.$destroy())
  }
}
```

代码较多，逐段分析：

```js
const oldVm = store._vm
store.getters = {}
store._makeLocalGettersCache = Object.create(null)
const wrappedGetters = store._wrappedGetters
const computed = {}
forEachValue(wrappedGetters, (fn, key) => {
  computed[key] = partial(fn, store)
  Object.defineProperty(store.getters, key, {
    get: () => store._vm[key],
    enumerable: true // for local getters
  })
})
```
因为在 resetStoreVM 函数中会创建新的 Vue 实例赋给 store._vm，创建前要先将 store._vm 赋给 oldVm，即 oldVm 保存了旧值

然后，给 store 对象上添加 getters 属性，值为一个空对象，添加 _makeLocalGettersCache 属性，值为一个空对象。store._wrappedGetters 赋给变量 wrappedGetters，它里面存放的是注册好了的 getter 方法。再定义一个 computed，指向一个空对象。

遍历 wrappedGetters 对象里注册好的 getter 方法，往 computed 对象添加属性，属性名为 getter 名，属性值为 partial 函数的返回值，下面看看 partial 函数。

```js
function partial (fn, arg) {
  return () => {
    return fn(arg)
  }
}
```

传入 partial 的是注册好的 getter 函数和 store 对象，返回一个新的函数，函数执行实际执行的是传入的 fn，即 getter 函数，getter 函数接收 store 对象执行。

也就是，不是直接给 computed 对象所添加 getter 方法，而是包裹一层的 getter，这么做的好处是，getter 在函数外部执行时，能通过闭包引用 partial 函数作用域中的 store 这个形参变量，因为形成了闭包，所以 store 不会随着 partial 函数执行结束而销毁。

在遍历 wrappedGetters 对象的过程中，除了往 computed 对象中添加包裹后的 getter，还要:

```js
Object.defineProperty(store.getters, key, {
  get: () => store._vm[key],
  enumerable: true
})
```
store.getters 还是一个空对象，通过 Object.defineProperty 给它添加只读属性，属性名是 getter 名，读取属性的值时，会触发它的 get 方法，返回 store._vm[key]，即转而读取 Vue 实例上的同名属性。

问题来了，为什么 store._vm 上会有 getter 的同名属性呢，原因是接下来这几句：

```js
const silent = Vue.config.silent
Vue.config.silent = true
store._vm = new Vue({
  data: {
    $$state: state
  },
  computed
})
Vue.config.silent = silent
```
首先获取 Vue.config.silent 的值并缓存给变量 silent。如果用户在使用 Vue 时，将它配置为真，代表取消 Vue 所有的日志与警告。

将 Vue.config.silent 置为 true，保证接下来创建 Vue 实例时，不会打印 Vue 的日志与警告，创建完 Vue 实例后，将它恢复为原来的值。因为这是“借用”了 Vue 的 API，实例化的过程可能会存在一些不严格的模式，但不希望因此报错。

实例化 Vue，data 选项传入$$state: state，$$state 变成了响应式属性，它的属性值：根 state 对象会被深度观测，即根 state 对象中的属性同样变成响应式属性，并且我们知道 Vue 实例会直接代理 Vue 实例的 _data 对象，即 store._vm 这个 Vue 实例会代理 store._vm._data 中的数据，因此，访问 store._vm.$$state 属性，就相当于访问 store._vm._data.$$state 属性。

而 Store 构造函数有 state 这个原型属性，读取它会触发 get state 方法：

```js
get state () {
  return this._vm._data.$$state
}
```
我们知道，安装了 Vuex 插件后，所有 Vue 组件实例的 $store 属性值，都指向同一个根 store 对象。因此，读取 vm.$store.state 的话，就是读取 store.state，会触发 state 的 get 函数，返回的是 store._vm._data.$$state

所以，state 对象响应式化后，访问 store.state 实际返回 vm 实例的 data 中的响应式数据

```js
store._vm = new Vue({
  data: {
    $$state: state
  },
  computed
})
```
因为 computed 对象存了 getter 方法，把 computed 对象作为 computed 选项传入 new Vue 后，getter 被初始化为计算属性。

比如，访问某个 Vue 实例 vm.$store.getters.xxx 时，即访问 store.getters.xxx，store.getters 对象已经通过 Object.defineProperties 添加了响应式只读属性 xxx，所以会触发 xxx 的 get 函数，返回 store._vm.xxx，为什么 store._vm.xxx 能获取到对应的 getter 方法呢，因为 xxx 已经被注册为 Vue 实例 store._vm 的计算属性了，所以 store._vm.xxx 可以访问到 xxx 的getter方法。

## Vuex.Store实例方法的实现
### commit

Vuex 的设计是：更改 store 中的 state 只能通过提交 mutation，mutation 有一个 type 字符串和一个处理函数 handler，handler 就是用来改变 state，并且它接收 state 作为第一个参数，比如：
```js
const store = new Vuex.Store({
  state:{
    a:1
  }
  mutations:{
    change(state) {
      state.a++
    }
  }
})
```
这其实就像注册事件的回调函数，当你调用 store.commit 触发 type 为 "change" 的 mutation 时，会触发它的 handler 回调，注意，mutation 的 handler 并不能直接被调用。

commit 是 Store 构造函数的原型方法，用户调用 commit 提交 mutation 有不同的传参方式，比如：

```js
store.commit('change') // 传 mutation 的 type 字符串

store.commit({ // 传一个包含 type 的对象
  type:'change',
  amount: 10
})

```

我们看看 commit 的实现：

```js
commit (_type, _payload, _options) {
  const {type, payload, options} = unifyObjectStyle(_type, _payload, _options)
  const mutation = { type, payload }
  const entry = this._mutations[type]
  if (!entry) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[vuex] unknown mutation type: ${type}`)
    }
    return
  }
  this._withCommit(() => {
    entry.forEach(function commitIterator (handler) {
      handler(payload)
    })
  })
  this._subscribers.forEach(sub => sub(mutation, this.state))
  // ...
}
```
commit 可以接收 3 个参数：

1. _type：要提交的目标 mutation 的 type 字符串，即 mutation 名
2. _payload：载荷对象（一般用户会传）
3. _options：配置对象，比如可以传 root: true，它允许在命名空间模块里提交根的 mutation

```

我们分段来看看 commit 的代码：

```js
const {type, payload, options} = unifyObjectStyle(_type, _payload, _options)
const mutation = { type, payload }
const entry = this._mutations[type]
if (!entry) {
  if (process.env.NODE_ENV !== 'production') {
    console.error(`[vuex] unknown mutation type: ${type}`)
  }
  return
}
```
unifyObjectStyle 函数已经介绍过了，它对参数做统一化处理，从执行结果中可以解构出 type, payload, options 变量。

创建一个包含 type 和 payload 的对象，赋给 mutation。获取 store 实例的 _mutations 对象中的 type 对应的 mutation 数组，赋给 entry。这个数组存放的是 type 这个 mutation 的回调函数。

如果 entry 不存在，说明这个 mutation 没有注册过，所以无法调用 store.commit 去提交这个 mutation，在开发环境下要打印警告：未知的 mutation type，然后直接返回

```js
if (!entry) {
  if (process.env.NODE_ENV !== 'production') {
    console.error(`[vuex] unknown mutation type: ${type}`)
  }
  return
}
```
接下来，继续看：

```js
this._withCommit(() => {
  entry.forEach(function commitIterator (handler) {
    handler(payload)
  })
})
```

前面分析过 _withCommit 作用是把 执行回调函数时，保证了 _committing 为 true，执行完回调后再把 _committing 恢复到原来的值。

我们看看回调做的事：遍历数组 entry，即 this._mutations[type] 数组，将数组每一个 handler 执行，传入用户调用 commit 时传入的 payload。即，type 对应的 handler 都执行一遍。

接下来：
```js
this._subscribers.forEach(sub => sub(mutation, this.state))
```

this._subscribers的this指向 store对象，_subscribers存放的是所有对mutation的订阅者
这是哪来的呢？？？其实我们看Vuex文档可知，Store有一个原型方法subscribe，虽然你很少用到它，它的作用是订阅mutation，然后handler会在mutation完成后调用，通常这个方法是用于插件，其实没啥必要看，既然都写到这了，看吧
```js
subscribe (fn) {
  return genericSubscribe(fn, this._subscribers)
}
function genericSubscribe (fn, subs) {
  if (subs.indexOf(fn) < 0) {
    subs.push(fn);
  }
  return function () {
    var i = subs.indexOf(fn);
    if (i > -1) {
      subs.splice(i, 1);
    }
  }
}
```
我们可以看到，subscribe接收一个回调函数fn，返回genericSubscribe的执行值，传入的是fn和存放所有对mutation的订阅者
genericSubscribe做了什么事，首先，如果subs数组中没有这个fn，就把它push进取
genericSubscribe执行返回一个函数，函数中会找到fn在subs数组中位置，并把fn从中删除。

。。。有点懵了
`this._subscribers.forEach(sub => sub(mutation, this.state))`
现在遍历 mutation 的订阅者数组，执行回调，sub就是你subscribe的时候自己写的回调fn，fn执行传入mutation和经过mutation后的state。

### dispatch

dispatch 和 commit 一样也是 Store 的原型方法，但它的作用是触发 action。action 方法通常包含异步操作， store.dispatch 会处理 action 方法返回的 promise，并且 store.dispatch 也会返回 promise。

```js
// 用户一般这么写 action 方法，用 promise 实例管控异步操作
actions:{
  actionA({ commit }){
    return new Promise((resolve, reject)=>{
      // 异步操作
    })
  }
}
```
那么用 store.dispatch 分发 action 用户可以这么写：
```js
store.dispatch('actionA').then(()=>{
  // ....
})
```

现在看看 dispatch 的实现，代码比较长，分段看：
```js
dispatch (_type, _payload) {
  const { type, payload } = unifyObjectStyle(_type, _payload)
  const action = { type, payload }
  const entry = this._actions[type]
  if (!entry) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[vuex] unknown action type: ${type}`)
    }
    return
  }
  // ....
}
```
和前面的一样，先调用 unifyObjectStyle 函数对 dispatch 函数接收的参数做归一化。

然后变量type, payload 解构到归一化后的 type, payload，把他们放进一个对象，赋给变量action。

定义 entry ，指向 this._actions[type]，它是存放 type 对应的 action 方法的数组。

如果 entry 不存在，说明该 type 的 action 还没注册，报警提示；未知的 action type，然后直接返回

接着继续：

```js
try {
  this._actionSubscribers
    .filter(sub => sub.before)
    .forEach(sub => sub.before(action, this.state))
} catch (e) {
  if (process.env.NODE_ENV !== 'production') {
    console.warn(`[vuex] error in before action subscribers: `)
    console.error(e)
  }
}
```
action 的订阅函数。。。算了，这里我不想分析了，还没用过它。

再接下来：

```js
const result = entry.length > 1
  ? Promise.all(entry.map(handler => handler(payload)))
  : entry[0](payload)
return result.then(res => {
  // ...
  return res
})
```

如果 entry 数组的长度 >1，说明 type 对应的 action 的处理函数有多个，可能每个处理函数就管控一个异步操作，我们不能简单地遍历依次执行 action，而是要把每个 action 的执行结果 (promise实例) 放到一个数组里，传给Promise.all，给它管控，Promise.all 的返回值才是最后的结果。

因为如果简单的遍历执行 action，entry.map(handler => handler(payload)) 数组赋给 result，由于这是同步代码，所以 res 拿到的数组里的 promise 的状态还是 pending。Promise.all(iterable) 返回一个 promise 实例， iterable 内所有的 promise 都成功或 iterable 内不包含 promise 时这个 promise 才会成功；如果 iterable 中有一个失败了，则该 promise 实例失败，失败的原因是第一个失败 promise 的结果。

也就是，Promise.all 会等待所有管控异步操作的 promise 都成功（或第一个失败），返回值是一个 promise 实例，赋给result，起初是 pending 状态，所有 promise 都有结果了，则 result 的状态也有结果了。

如果 entry 数组只有一个，则执行这个 handler 函数，传入 payload，返回值赋给 result。

我们知道 registerAction 函数中将 action 的处理函数包裹成 wrappedActionHandler 函数，推入 entry 数组，它返回的一定是 promise 实例，所以无论是 Promise.all 的返回值还是 entry[0](payload)，它一定是 promise 实例，它可以调用 then，做一些处理后，返回 res。

## 辅助函数的实现

### mapState

当你想在一个 Vue 组件中使用一个 state 数据 xxx 时，你可以通过 this.$store.state.xxx，这样每次都这么读取会比较麻烦，你可以将它声明为当前组件的一个计算属性。

但当一个组件需要使用到多个 state 时，将这些 state 都声明为 computed 会有些繁琐。我们可以使用 mapState 这个辅助函数帮助我们生成计算属性

我们看看 mapState 函数的实现：
```js
var mapState = normalizeNamespace(function (namespace, states) {
  var res = {};
  normalizeMap(states).forEach(function (ref) {
    // ...
  });
  return res
});
```

可以看到它是 normalizeNamespace 函数的返回值，normalizeNamespace 做了什么事情：

```js
function normalizeNamespace (fn) {
  return function (namespace, map) {
    if (typeof namespace !== 'string') {
      map = namespace;
      namespace = '';
    } else if (namespace.charAt(namespace.length - 1) !== '/') {
      namespace += '/';
    }
    return fn(namespace, map)
  }
}
```
normalizeNamespace 接收一个函数 fn，返回出一个新的函数，因此 mapState 就指向这个新函数，它接收两个参数：namespace 和 map。

做了什么事情？首先判断 namespace，如果不是字符串，就把传入的第一个参数作为 map，namespace 赋值为 ''。如果是字符串，但最后一个字符不是 "/" ，要给 namespace 末尾加上 "/"，也就是说，这个 type 字符串是考虑命名空间的字符串，Vuex 原则上期望你末尾带上 "/"，如果没有带，则会给你都补上。

处理完返回 namespace 字符串后，执行并返回 fn(namespace, map)，即 mapState 执行实际返回 fn 的执行结果，
我们具体看看传入的 fn 是怎么样的：
```js
var mapState = normalizeNamespace(function (namespace, states) {
  var res = {};
  normalizeMap(states).forEach(function (ref) {
    // ...
  });
  return res
});
```

可以看到这个 fn 执行返回 res 对象，normalizeMap(states) 遍历的过程中肯定往 res 对象填充属性了，我们先看看 normalizeMap(states) 返回了什么内容，下面是 normalizeMap 的实现

```js
function normalizeMap (map) {
  return Array.isArray(map)
    ? map.map(key => ({ key, val: key }))
    : Object.keys(map).map(key => ({ key, val: map[key] }))
}
```
normalizeMap(states) 接收 states，就是用户调用 mapState 传入的第二个参数（对象形式）。

normalizeMap 函数中，首先判断这个 states 是否为数组，如果是，将数组每项 key 字符串转成 { key:key, val:key } 这样的对象

如果不是，则默认用户传的是对象，调用 Object.keys 获取 states 对象的所有自有属性组成的数组，然后同样地，将每一项 key 字符串转成 { key: key, val: map[key] }

normalizeMap 其实就是适应用户的不同形式的传参，做的是一种参数的归一化的整理

接着这个归一化后的数组会进行 forEach 遍历，我们具体看看 forEach 的回调函数：

```js
normalizeMap(states).forEach(function (ref) {
  var key = ref.key;
  var val = ref.val;
  res[key] = function mappedState () {
    var state = this.$store.state;
    var getters = this.$store.getters;
    if (namespace) {
      var module = getModuleByNamespace(this.$store, 'mapState', namespace);
      if (!module) {
        return
      }
      state = module.context.state;
      getters = module.context.getters;
    }
    return typeof val === 'function'
      ? val.call(this, state, getters)
      : state[val]
  };
  // mark vuex getter for devtools
  res[key].vuex = true;
});
```

回调函数中，参数 ref 拿到当前遍历的对象，key 拿到对象中的 key 值，val 拿到对象中的 val 值。res 初始是一个空对象，现在遍历的过程，要给它中添加方法，属性值为 key，方法为 mappedState 函数。

mappedState 函数做了什么？

首先 state 变量获取到 store 的 state，getters 变量获取到 store 的 getters。前面提过，如果用户没有给 mapState 传字符串，则 namespace 是空字符串，否则它不为空字符串，则调用 getModuleByNamespace 函数获取到它对应的 module 对象，赋给 module，我们粗略看看 getModuleByNamespace 的实现：

```js
var module = getModuleByNamespace(this.$store, 'mapState', namespace);
// 
function getModuleByNamespace (store, helper, namespace) {
    var module = store._modulesNamespaceMap[namespace];
    if (!module) {
      console.error(("[vuex] module namespace not found in " + helper + "(): " + namespace));
    }
    return module
  }
```
可以看到，传入 getModuleByNamespace 的 3 个参数分别是：

1. store 对象
2. 'mapState'：是一个区分于其他调用的标识
3. namespace：命名空间字符串

首先，会去 store._modulesNamespaceMap 这个存放 namespace 对应的模块的对象，去找出 namespace 对应的 module。

如果 module 没找到，则报错提示：你要找的 namespace 在 _modulesNamespaceMap 对象中找不到对应的模块对象。如果找到了，就把它返回。

前面已经谈过，在实例化 Store 时，已经把所有的模块和它对应的 namespace 都以键值对的形式添加到了 store._modulesNamespaceMap 缓存对象中。

```js
if (namespace) {
  var module = getModuleByNamespace(this.$store, 'mapState', namespace);
  if (!module) {
    return
  }
  state = module.context.state;
  getters = module.context.getters;
}
```
通过 getModuleByNamespace 获取到 module 后，判断 module 不存在就直接返回，因为用户 mapState 传的这个命名空间字符串呢，不一定对应有模块对象，可能是它拼错了这个字符串呢。

然后，state 赋值为module.context.state，这个又是什么，其实我们前面也分析过：

`var local = module.context = makeLocalContext(store, namespace, path);`

它就是 local 对象，是为当前模块设置的本地的包含 dispatch、commit 方法，和 getter 和 state 属性的对象。

于是 state 拿到本地的（带命名空间的）的 state，getters 拿到本地的（带命名空间的）的 getters

mappedState 函数最后返回：

```js
return typeof val === 'function' 
      ? val.call(this, state, getters)
      : state[val]
```

val 是什么？它是 normalizeMap(states) 数组中当前遍历对象的 val 值，如果它是函数，则默认用户调用 mapState 传的第二个参数是一个对象，而且属性值是函数，那么直接调用 val 这个函数，执行时 this 指向当前 Vue 实例，因为 mapState 调用的环境中，this 指向 当前 Vue 实例。val 执行传入 state，getters。

如果 val 不是函数，则默认用户调用 mapState 传的第二个参数是由字符串组成的数组，返回 state[val]，即通过本地的 key 字符串获取到 state 对象中对应的 state。

综上，我们了解了 mapState 函数接收参数的形式：第一个参数可以接收模块的空间命名字符串，也可以不传，第二个参数是一个 map 对象，可以传数组或对象。

mapState 会返回一个对象 res，里面存放的属性名是用户在 map 对象中起的字符串，属性值一个 mappedState 函数，函数执行返回 state 对象中对应 state 值

因此，你可以这么使用mapState

比如
```js
 computed: mapState({
    count: state => state.count,
    countAlias: 'count',
    // 传字符串参数 'count' 等同于 `state => state.count`    
    countPlusLocalState (state) {
      return state.count + this.localCount
    }
    // 为了能够使用 `this` 获取局部状态，必须使用常规函数
  })
```
mapState 传入的这个对象，就是 map 对象，它会经过 normalizeMap 处理，转成数组，每个元素是一个对象{ key, val }，然后遍历这个数组，往待返回的对象 res 里添加方法，方法名为 key，如果 val 是函数，就直接返回 val 的执行结果，如果不是，就返回 state 中 val 的值，比如上面的 countAlias: 'count'

mapState 返回的对象，作为 computed 选项，那么 count，countAlias，countPlusLocalState 都被初始化为计算属性

用户给 mapState 传入的 map 还可以是数组，比如这么写：

```js
computed: mapState([
  'count',// 映射 this.count 为 store.state.count
  'xxxxx'
])
```
mapState 会将数组的每项转成 {'count': 'count'} 这样的形式，遍历数组，往 res 对象里添加方法，方法名为 'count'，方法本身执行返回 store.state.count

mapState 返回的是对象，我们可以用对象展开运算符，将里面的键值对直接混入到 computed 的配置对象中，这样就不影响用户写别的自定义计算属性：
```js
computed: {
  localComputed () { /* ... */ },
  ...mapState({
    // ...
  })
}
```
那带命名空间的模块里的state呢，怎么通过mapState获取，可以这么写
```js
computed: {
  ...mapState({
    a: state => state.some.nested.module.a,
    b: state => state.some.nested.module.b
  })
},
```
"a" 和 "b" 是用户起的计算属性名，属性值是返回对应 state 数据的函数，这样就能绑定带命名空间的模块，但这么写明显比较繁琐。

用户 mapState 时第一个参数可以传模块的空间命名字符串，这样所有的绑定会自动将该模块作为上下文。

```js
computed: {
  ...mapState('some/nested/module', {
    a: state => state.a,
    b: state => state.b
  })
},
```
由前面的源码我们知道，mapState 会根据 namespace 获取对应的模块 module，然后函数中的 state 就不再指向根 state，被覆盖为 module.context.state，即对应模块的 state，剩下的逻辑和前面一样，第二个参数 map 对象中的函数的 state 就不是根 state了，而是当地化的 state。

是不是终于搞懂了 mapState 的内部实现？

### mapGetters
和mapState的实现很像
```js
  var mapGetters = normalizeNamespace((namespace, getters) => {
  const res = {}
  normalizeMap(getters).forEach(({ key, val }) => {
    val = namespace + val
    res[key] = function mappedGetter () {
      if (namespace && !getModuleByNamespace(this.$store, 'mapGetters', namespace)) {
        return
      }
      if (process.env.NODE_ENV !== 'production' && !(val in this.$store.getters)) {
        console.error(`[vuex] unknown getter: ${val}`)
        return
      }
      return this.$store.getters[val]
    }
    res[key].vuex = true
  })
  return res
})
```
我们这直接讲了，不分段了。mapGetters接收namespace（可选）和getters（一个map对象），mapGetters执行也就是normalizeNamespace传入的函数执行，准备一个待返回的对象res，将传入的map对象经过normalizeMap处理成数组，map对象有两种形式：

1. ['getter1', 'getter2']   数组项就是store里getter的真实名字
2. { myGetter1: 'getter1'}  你想将getter属性取另一个名字，就这样使用对象形式

key取数组项里的key，val取它的val，如果存在命名空间的话，val = namespace + val;
往res对象中添加键值对，属性值为key，属性值为函数，函数返回store里的getters中val对应的getter，最后mapGetters执行返回出这个res对象

所以...mapGetter()出来的一个个计算属性，他们的函数返回值是store.getters对应的属性值


### mapActions
```js
  var mapActions = normalizeNamespace((namespace, actions) => {
    const res = {}
    normalizeMap(actions).forEach(({ key, val }) => {
      res[key] = function mappedAction (...args) {
        // get dispatch function from store
        let dispatch = this.$store.dispatch
        if (namespace) {
          const module = getModuleByNamespace(this.$store, 'mapActions', namespace)
          if (!module) return
          dispatch = module.context.dispatch
        }
        return typeof val === 'function'
          ? val.apply(this, [dispatch].concat(args))
          : dispatch.apply(this.$store, [val].concat(args))
      }
    })
    return res
  })
```
和前面俩一样，mapActions执行也就是normalizeNamespace的参数回调执行，回调函数中，准备一个空对象res，
normalizeMap会将mapActions接收的action对象格式化成一个数组，遍历数组，往res对象中添加键值对，key: 一个函数
这个函数所接收的参数组成了数组args，这个函数中，先缓存了this.$store.dispatch的方法，如果namespace存在，说明mapActions时传入的第一个参数是带命名空间的字符串，根据namespace获取对应的模块，获取不到就直接返回，然后把dispatch变量更新为所找到的模块对应的dispatch方法（local的，当地化后的）
最后判断val是否是一个函数，是则直接调用，this指向当前Vue实例，如果是一个函数，（这里没太搞懂，但可以肯定的是我们经常不这么写）如果不是一个函数，则调用dispatch方法，this指向store对象，传入action的名字字符串，即val，和作为method接收的参数args。

比如，你会这么写：
```js
methods:{
  ...mapActions(['action1', 'action2']),

  ...mapActions({
    myAction3: 'action3'
  }),
}
```
第一个mapActions执行返回的对象中，{ 'action1': 函数1, 'action2': 函数2 }
这个对象被展开后混入methods中成为method，那么函数1作为method，它接收的参数，参数数组args
函数1里面做的事情就是 this.$store.dispatch('action1', ...args)
就像下面这样
```js
action1(...args){
  this.$store.dispatch('action1', ...args)
}
```
第二个mapActions执行返回的对象，会像这样：{ 'myAction3' : 函数3 }
这个对象被展开后混入methods，成为method，它接收的参数放到一个数组里args
```js
myAction3(...args){
  this.$store.dispatch('action3', ...args)
}
```
所以函数3里做的事情就是 this.$store.dispatch('action3', ...args)


### mapMutations

```js
var mapMutations = normalizeNamespace((namespace, mutations) => {
    const res = {}
    normalizeMap(mutations).forEach(({ key, val }) => {
      res[key] = function mappedMutation (...args) {
        let commit = this.$store.commit
        if (namespace) {
          const module = getModuleByNamespace(this.$store, 'mapMutations', namespace)
          if (!module) return
          commit = module.context.commit
        }
        return typeof val === 'function'
          ? val.apply(this, [commit].concat(args))
          : commit.apply(this.$store, [val].concat(args))
      }
    })
    return res
  })
```
同样的，mapMutations执行相当于(namespace, mutations) => {....这个回调执行，返回出一个对象res
比如你这么使用：
```js
methods: {
    ...mapMutations(['muta1',  'muta2' ]),

    ...mapMutations({ myMuta3: 'muta3' })
  }
```
比如第一个，返回的res对象就像这样: { 'muta1': 函数1 ,  'muta2': 函数2  }
muta1就成了method名，method值为函数1，那函数1接收的参数数组为args
函数1其实就是源码中的mappedMutation函数，它做了什么：获取this.$store.commit，如果传来模块命名空间字符串，就获取模块本地化的commit，然后 执行 commit.apply(this.$store, [val].concat(args))
也就是 `this.$store.commit('muta1', ...args)`

第二个也类似，变成这样的method
```js
methods:{
  myMuta3(...args){
    this.$store.commit('muta3' , ...args)
  }
}
```

现在好像 Vuex源码基本分析完了。。
